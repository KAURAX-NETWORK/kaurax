// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "../interfaces/IERC20.sol";

/// @title KauraxLaunchpad
/// @notice Token sales on KAURAX, paid for in KAX.
///
/// @dev The design goal is that a buyer's funds are never at the creator's discretion:
///
///        * **Tokens are escrowed before the sale opens.** A sale cannot start until the
///          full allocation is held by this contract, so it is impossible to raise KAX for
///          tokens that do not exist.
///        * **A soft cap decides who gets what.** Below it, every buyer can withdraw their
///          full contribution and the creator receives nothing. At or above it, buyers claim
///          tokens and the creator claims the raise. There is no path where the creator
///          takes the KAX and buyers are left holding nothing.
///        * **The creator cannot touch the KAX before the sale ends**, cannot cancel a sale
///          that has begun, and cannot change its terms.
///        * **Claims are pull-based** and guarded, so one buyer's reverting fallback cannot
///          block everyone else.
///
///      Deliberately absent: vesting, whitelists, tiers, referral bonuses. They are not
///      implemented, so they are not implied.
contract KauraxLaunchpad {
    enum Status {
        Pending, // created, tokens not yet escrowed
        Funded, // tokens escrowed, awaiting the start time
        Live, // accepting contributions
        Succeeded, // ended at or above the soft cap
        Failed, // ended below the soft cap; refunds available
        Cancelled // cancelled before it opened
    }

    struct Sale {
        address creator;
        address token;
        /// @notice Token units sold per 1 KAX (1e18 wei), in the token's own decimals.
        uint256 tokensPerKax;
        /// @notice Total token units escrowed for the sale.
        uint256 tokensForSale;
        uint256 softCapWei;
        uint256 hardCapWei;
        uint256 minContributionWei;
        uint256 maxContributionWei;
        uint64 startsAt;
        uint64 endsAt;
        uint256 raisedWei;
        uint256 tokensSold;
        bool tokensDeposited;
        bool finalised;
        bool creatorPaid;
        bool cancelled;
        string metadataURI;
    }

    uint256 public saleCount;
    mapping(uint256 => Sale) internal _sales;

    /// @notice saleId => buyer => KAX contributed.
    mapping(uint256 => mapping(address => uint256)) public contributionOf;
    /// @notice saleId => buyer => whether tokens or a refund have been taken.
    mapping(uint256 => mapping(address => bool)) public claimed;

    /// @notice Reentrancy guard across every value-moving entry point.
    uint256 private _locked = 1;

    event SaleCreated(
        uint256 indexed saleId, address indexed creator, address indexed token, string metadataURI
    );
    event TokensDeposited(uint256 indexed saleId, uint256 amount);
    event Contributed(uint256 indexed saleId, address indexed buyer, uint256 amountWei, uint256 tokenAmount);
    event SaleFinalised(uint256 indexed saleId, bool succeeded, uint256 raisedWei, uint256 tokensSold);
    event TokensClaimed(uint256 indexed saleId, address indexed buyer, uint256 amount);
    event Refunded(uint256 indexed saleId, address indexed buyer, uint256 amountWei);
    event CreatorPaid(uint256 indexed saleId, address indexed creator, uint256 amountWei);
    event UnsoldTokensReturned(uint256 indexed saleId, uint256 amount);
    event SaleCancelled(uint256 indexed saleId);

    error Reentrancy();
    error UnknownSale();
    error NotCreator();
    error ZeroAddress();
    error InvalidTiming();
    error InvalidCaps();
    error InvalidPrice();
    error AlreadyDeposited();
    error TokensNotDeposited();
    error SaleNotLive();
    error SaleNotEnded();
    error AlreadyFinalised();
    error NotFinalised();
    error SaleAlreadyStarted();
    error SaleCancelledError();
    error ContributionTooSmall(uint256 minimum);
    error ContributionTooLarge(uint256 maximum);
    error HardCapExceeded(uint256 remaining);
    error NothingToClaim();
    error AlreadyClaimed();
    error SaleSucceededSoNoRefund();
    error SaleFailedSoNoTokens();
    error AlreadyPaid();
    error TransferFailed();

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 0;
        _;
        _locked = 1;
    }

    modifier onlyCreator(uint256 saleId) {
        if (saleId >= saleCount) revert UnknownSale();
        if (_sales[saleId].creator != msg.sender) revert NotCreator();
        _;
    }

    // ------------------------------------------------------------------ //
    //                             Creation                               //
    // ------------------------------------------------------------------ //

    function createSale(
        address token,
        uint256 tokensPerKax,
        uint256 tokensForSale,
        uint256 softCapWei,
        uint256 hardCapWei,
        uint256 minContributionWei,
        uint256 maxContributionWei,
        uint64 startsAt,
        uint64 endsAt,
        string calldata metadataURI
    ) external returns (uint256 saleId) {
        if (token == address(0)) revert ZeroAddress();
        if (tokensPerKax == 0 || tokensForSale == 0) revert InvalidPrice();
        if (startsAt < block.timestamp || endsAt <= startsAt) revert InvalidTiming();
        if (softCapWei == 0 || hardCapWei < softCapWei) revert InvalidCaps();
        if (maxContributionWei == 0 || maxContributionWei < minContributionWei) revert InvalidCaps();

        // The escrow must be able to satisfy the hard cap, or a late buyer's KAX would be
        // accepted against tokens that are not there.
        uint256 needed = (hardCapWei * tokensPerKax) / 1e18;
        if (tokensForSale < needed) revert InvalidCaps();

        saleId = saleCount++;
        Sale storage sale = _sales[saleId];
        sale.creator = msg.sender;
        sale.token = token;
        sale.tokensPerKax = tokensPerKax;
        sale.tokensForSale = tokensForSale;
        sale.softCapWei = softCapWei;
        sale.hardCapWei = hardCapWei;
        sale.minContributionWei = minContributionWei;
        sale.maxContributionWei = maxContributionWei;
        sale.startsAt = startsAt;
        sale.endsAt = endsAt;
        sale.metadataURI = metadataURI;

        emit SaleCreated(saleId, msg.sender, token, metadataURI);
    }

    /// @notice Escrow the sale allocation. Required before contributions are accepted.
    /// @dev The amount credited is the measured balance delta, so a fee-on-transfer token
    ///      cannot under-deliver while claiming the full allocation.
    // Same shape, same answer: the function is already `nonReentrant`, which the detector
    // does not model. Suppressed as a false positive, not to quiet the gate.
    // slither-disable-next-line reentrancy-balance
    function depositTokens(uint256 saleId) external nonReentrant onlyCreator(saleId) {
        Sale storage sale = _sales[saleId];
        if (sale.tokensDeposited) revert AlreadyDeposited();
        if (sale.cancelled) revert SaleCancelledError();

        uint256 before = IERC20(sale.token).balanceOf(address(this));
        _safeTransferFrom(sale.token, msg.sender, address(this), sale.tokensForSale);
        uint256 received = IERC20(sale.token).balanceOf(address(this)) - before;

        // Credit only what actually arrived, and reduce the offer to match.
        sale.tokensForSale = received;
        uint256 needed = (sale.hardCapWei * sale.tokensPerKax) / 1e18;
        if (received < needed) revert InvalidCaps();

        sale.tokensDeposited = true;
        emit TokensDeposited(saleId, received);
    }

    /// @notice Cancel a sale that has not opened yet, returning any escrowed tokens.
    function cancelSale(uint256 saleId) external nonReentrant onlyCreator(saleId) {
        Sale storage sale = _sales[saleId];
        if (block.timestamp >= sale.startsAt) revert SaleAlreadyStarted();
        if (sale.cancelled) revert SaleCancelledError();

        sale.cancelled = true;
        if (sale.tokensDeposited) {
            sale.tokensDeposited = false;
            _safeTransfer(sale.token, sale.creator, sale.tokensForSale);
        }
        emit SaleCancelled(saleId);
    }

    // ------------------------------------------------------------------ //
    //                           Participation                            //
    // ------------------------------------------------------------------ //

    function contribute(uint256 saleId) external payable nonReentrant {
        if (saleId >= saleCount) revert UnknownSale();
        Sale storage sale = _sales[saleId];

        if (sale.cancelled) revert SaleCancelledError();
        if (!sale.tokensDeposited) revert TokensNotDeposited();
        if (block.timestamp < sale.startsAt || block.timestamp > sale.endsAt) revert SaleNotLive();

        uint256 already = contributionOf[saleId][msg.sender];
        uint256 total = already + msg.value;

        if (total < sale.minContributionWei) revert ContributionTooSmall(sale.minContributionWei);
        if (total > sale.maxContributionWei) revert ContributionTooLarge(sale.maxContributionWei);

        uint256 remaining = sale.hardCapWei - sale.raisedWei;
        if (msg.value > remaining) revert HardCapExceeded(remaining);

        contributionOf[saleId][msg.sender] = total;
        sale.raisedWei += msg.value;

        uint256 tokenAmount = (msg.value * sale.tokensPerKax) / 1e18;
        sale.tokensSold += tokenAmount;

        emit Contributed(saleId, msg.sender, msg.value, tokenAmount);
    }

    /// @notice Settle the sale once it has ended. Callable by anyone.
    /// @dev Permissionless on purpose: a creator who walks away must not be able to strand
    ///      buyers' refunds by never finalising.
    function finalise(uint256 saleId) external nonReentrant {
        if (saleId >= saleCount) revert UnknownSale();
        Sale storage sale = _sales[saleId];

        if (sale.cancelled) revert SaleCancelledError();
        if (sale.finalised) revert AlreadyFinalised();
        // Finalising early is allowed only once the hard cap makes the outcome certain.
        if (block.timestamp <= sale.endsAt && sale.raisedWei < sale.hardCapWei) revert SaleNotEnded();

        sale.finalised = true;
        bool succeeded = sale.raisedWei >= sale.softCapWei;

        emit SaleFinalised(saleId, succeeded, sale.raisedWei, sale.tokensSold);

        if (succeeded) {
            uint256 unsold = sale.tokensForSale - sale.tokensSold;
            if (unsold > 0) {
                _safeTransfer(sale.token, sale.creator, unsold);
                emit UnsoldTokensReturned(saleId, unsold);
            }
        } else {
            // Failed: the whole allocation goes back, and buyers refund themselves.
            _safeTransfer(sale.token, sale.creator, sale.tokensForSale);
            emit UnsoldTokensReturned(saleId, sale.tokensForSale);
        }
    }

    /// @notice Claim purchased tokens after a successful sale.
    function claimTokens(uint256 saleId) external nonReentrant {
        if (saleId >= saleCount) revert UnknownSale();
        Sale storage sale = _sales[saleId];

        if (!sale.finalised) revert NotFinalised();
        if (sale.raisedWei < sale.softCapWei) revert SaleFailedSoNoTokens();
        if (claimed[saleId][msg.sender]) revert AlreadyClaimed();

        uint256 contributed = contributionOf[saleId][msg.sender];
        if (contributed == 0) revert NothingToClaim();

        claimed[saleId][msg.sender] = true;
        uint256 amount = (contributed * sale.tokensPerKax) / 1e18;

        emit TokensClaimed(saleId, msg.sender, amount);
        _safeTransfer(sale.token, msg.sender, amount);
    }

    /// @notice Reclaim KAX after a failed or cancelled sale.
    function refund(uint256 saleId) external nonReentrant {
        if (saleId >= saleCount) revert UnknownSale();
        Sale storage sale = _sales[saleId];

        if (!sale.cancelled) {
            if (!sale.finalised) revert NotFinalised();
            if (sale.raisedWei >= sale.softCapWei) revert SaleSucceededSoNoRefund();
        }
        if (claimed[saleId][msg.sender]) revert AlreadyClaimed();

        uint256 contributed = contributionOf[saleId][msg.sender];
        if (contributed == 0) revert NothingToClaim();

        // Marked before the transfer, so a reentrant call finds nothing to take.
        claimed[saleId][msg.sender] = true;

        emit Refunded(saleId, msg.sender, contributed);
        _sendKAX(msg.sender, contributed);
    }

    /// @notice Creator withdraws the raise, only after a successful finalisation.
    function withdrawRaise(uint256 saleId) external nonReentrant onlyCreator(saleId) {
        Sale storage sale = _sales[saleId];

        if (!sale.finalised) revert NotFinalised();
        if (sale.raisedWei < sale.softCapWei) revert SaleFailedSoNoTokens();
        if (sale.creatorPaid) revert AlreadyPaid();

        sale.creatorPaid = true;
        uint256 amount = sale.raisedWei;

        emit CreatorPaid(saleId, sale.creator, amount);
        _sendKAX(sale.creator, amount);
    }

    // ------------------------------------------------------------------ //
    //                              Queries                               //
    // ------------------------------------------------------------------ //

    function getSale(uint256 saleId) external view returns (Sale memory) {
        if (saleId >= saleCount) revert UnknownSale();
        return _sales[saleId];
    }

    function statusOf(uint256 saleId) public view returns (Status) {
        if (saleId >= saleCount) revert UnknownSale();
        Sale storage sale = _sales[saleId];

        if (sale.cancelled) return Status.Cancelled;
        if (sale.finalised) return sale.raisedWei >= sale.softCapWei ? Status.Succeeded : Status.Failed;
        if (!sale.tokensDeposited) return Status.Pending;
        if (block.timestamp < sale.startsAt) return Status.Funded;
        if (block.timestamp <= sale.endsAt && sale.raisedWei < sale.hardCapWei) return Status.Live;
        // Ended but not yet finalised: report the outcome it will settle to.
        return sale.raisedWei >= sale.softCapWei ? Status.Succeeded : Status.Failed;
    }

    /// @notice Tokens a buyer would receive if the sale succeeds.
    function allocationOf(uint256 saleId, address buyer) external view returns (uint256) {
        if (saleId >= saleCount) revert UnknownSale();
        return (contributionOf[saleId][buyer] * _sales[saleId].tokensPerKax) / 1e18;
    }

    function remainingCapacityWei(uint256 saleId) external view returns (uint256) {
        if (saleId >= saleCount) revert UnknownSale();
        Sale storage sale = _sales[saleId];
        return sale.hardCapWei - sale.raisedWei;
    }

    // ------------------------------------------------------------------ //
    //                             Internals                              //
    // ------------------------------------------------------------------ //

    function _safeTransfer(address token, address to, uint256 value) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (to, value)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transferFrom, (from, to, value)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    // slither-disable-next-line arbitrary-send-eth
    function _sendKAX(address to, uint256 amount) internal {
        // `to` is a contributor claiming their own refund or the sale owner claiming
        // proceeds; both are established by the sale's accounting before this is reached.
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
