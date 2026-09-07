// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title KauraxMultisig
/// @notice An m-of-n multisig for KAURAX's privileged roles.
///
/// @dev Every privileged role in KAURAX — guardian, challenger, contract owners — is a
///      single externally owned account by default. One compromised key is then enough to
///      pause the bridge, delete valid output proposals, or rotate the batcher. This
///      contract exists to make that require m independent signatures instead.
///
///      Deliberately small and auditable. No upgradeability, no modules, no delegatecall,
///      no off-chain signature aggregation. Owners confirm on chain, which costs more gas
///      and buys a far smaller attack surface.
///
///      Design points worth knowing:
///        * **Confirmations are revoked when the owner set changes.** Otherwise a removed
///          owner's confirmation would still count toward a threshold they are no longer
///          part of.
///        * **A transaction records the owner-set version it was confirmed under**, so a
///          proposal cannot accumulate signatures across a membership change.
///        * **Execution is single-shot and marked before the call**, so a reentrant target
///          cannot execute the same transaction twice.
contract KauraxMultisig {
    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
        /// @dev Owner-set version this proposal belongs to.
        uint64 ownerEpoch;
        /// @dev Free-text reason, for anyone reading the chain later.
        string description;
    }

    address[] private _owners;
    mapping(address => bool) public isOwner;

    /// @notice Signatures required to execute.
    uint256 public threshold;

    /// @notice Incremented whenever the owner set or threshold changes.
    uint64 public ownerEpoch;

    Transaction[] private _transactions;
    mapping(uint256 => mapping(address => bool)) public confirmedBy;

    event Submitted(
        uint256 indexed txId, address indexed owner, address indexed to, uint256 value, string description
    );
    event Confirmed(uint256 indexed txId, address indexed owner, uint256 confirmations);
    event ConfirmationRevoked(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId, address indexed executor);
    event ExecutionFailed(uint256 indexed txId, bytes reason);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ThresholdChanged(uint256 previous, uint256 current);
    event Deposit(address indexed from, uint256 amount);

    error NotOwner();
    error NotSelf();
    error ZeroAddress();
    error AlreadyOwner();
    error InvalidThreshold(uint256 requested, uint256 ownerCount);
    error UnknownTransaction();
    error AlreadyExecuted();
    error AlreadyConfirmed();
    error NotConfirmed();
    error StaleProposal(uint64 proposalEpoch, uint64 currentEpoch);
    error NotEnoughConfirmations(uint256 have, uint256 need);
    error ExecutionReverted();
    error LastOwner();

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    /// @dev Owner-set changes must themselves go through the multisig.
    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    constructor(address[] memory owners_, uint256 threshold_) {
        if (owners_.length == 0) revert ZeroAddress();
        if (threshold_ == 0 || threshold_ > owners_.length) {
            revert InvalidThreshold(threshold_, owners_.length);
        }

        for (uint256 i; i < owners_.length; i++) {
            address owner = owners_[i];
            if (owner == address(0)) revert ZeroAddress();
            if (isOwner[owner]) revert AlreadyOwner();
            isOwner[owner] = true;
            _owners.push(owner);
            emit OwnerAdded(owner);
        }

        threshold = threshold_;
        emit ThresholdChanged(0, threshold_);
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    // ------------------------------------------------------------------ //
    //                            Proposals                               //
    // ------------------------------------------------------------------ //

    /// @notice Propose a call, and confirm it in the same transaction.
    function submit(address to, uint256 value, bytes calldata data, string calldata description)
        external
        onlyOwner
        returns (uint256 txId)
    {
        if (to == address(0)) revert ZeroAddress();

        txId = _transactions.length;
        _transactions.push(
            Transaction({
                to: to,
                value: value,
                data: data,
                executed: false,
                confirmations: 0,
                ownerEpoch: ownerEpoch,
                description: description
            })
        );

        emit Submitted(txId, msg.sender, to, value, description);
        _confirm(txId);
    }

    function confirm(uint256 txId) external onlyOwner {
        _confirm(txId);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        Transaction storage t = _load(txId);
        if (t.executed) revert AlreadyExecuted();
        if (!confirmedBy[txId][msg.sender]) revert NotConfirmed();

        confirmedBy[txId][msg.sender] = false;
        unchecked {
            t.confirmations--;
        }
        emit ConfirmationRevoked(txId, msg.sender);
    }

    /// @notice Execute a fully confirmed proposal. Any owner may trigger it.
    function execute(uint256 txId) external onlyOwner {
        Transaction storage t = _load(txId);
        if (t.executed) revert AlreadyExecuted();
        // A proposal confirmed under an older owner set is not valid under the new one.
        if (t.ownerEpoch != ownerEpoch) revert StaleProposal(t.ownerEpoch, ownerEpoch);
        if (t.confirmations < threshold) revert NotEnoughConfirmations(t.confirmations, threshold);

        // Marked before the call: a reentrant target finds it already executed.
        t.executed = true;

        (bool ok, bytes memory ret) = t.to.call{value: t.value}(t.data);
        if (!ok) {
            emit ExecutionFailed(txId, ret);
            revert ExecutionReverted();
        }
        emit Executed(txId, msg.sender);
    }

    // ------------------------------------------------------------------ //
    //                          Owner management                          //
    // ------------------------------------------------------------------ //
    // These are callable only by the multisig itself, so changing membership requires
    // the current threshold of signatures.

    function addOwner(address owner) external onlySelf {
        if (owner == address(0)) revert ZeroAddress();
        if (isOwner[owner]) revert AlreadyOwner();

        isOwner[owner] = true;
        _owners.push(owner);
        unchecked {
            ownerEpoch++;
        }
        emit OwnerAdded(owner);
    }

    function removeOwner(address owner) external onlySelf {
        if (!isOwner[owner]) revert NotOwner();
        if (_owners.length == 1) revert LastOwner();

        isOwner[owner] = false;
        for (uint256 i; i < _owners.length; i++) {
            if (_owners[i] == owner) {
                _owners[i] = _owners[_owners.length - 1];
                _owners.pop();
                break;
            }
        }

        // Removing an owner can leave the threshold unreachable; lower it rather than
        // permanently bricking the multisig.
        if (threshold > _owners.length) {
            emit ThresholdChanged(threshold, _owners.length);
            threshold = _owners.length;
        }

        unchecked {
            ownerEpoch++;
        }
        emit OwnerRemoved(owner);
    }

    function changeThreshold(uint256 newThreshold) external onlySelf {
        if (newThreshold == 0 || newThreshold > _owners.length) {
            revert InvalidThreshold(newThreshold, _owners.length);
        }
        emit ThresholdChanged(threshold, newThreshold);
        threshold = newThreshold;
        unchecked {
            ownerEpoch++;
        }
    }

    // ------------------------------------------------------------------ //
    //                              Queries                               //
    // ------------------------------------------------------------------ //

    function owners() external view returns (address[] memory) {
        return _owners;
    }

    function ownerCount() external view returns (uint256) {
        return _owners.length;
    }

    function transactionCount() external view returns (uint256) {
        return _transactions.length;
    }

    function getTransaction(uint256 txId)
        external
        view
        returns (
            address to,
            uint256 value,
            bytes memory data,
            bool executed,
            uint256 confirmations,
            uint64 proposalEpoch,
            string memory description
        )
    {
        Transaction storage t = _load(txId);
        return (t.to, t.value, t.data, t.executed, t.confirmations, t.ownerEpoch, t.description);
    }

    /// @notice Whether a proposal could execute right now.
    function isExecutable(uint256 txId) external view returns (bool) {
        if (txId >= _transactions.length) return false;
        Transaction storage t = _transactions[txId];
        return !t.executed && t.ownerEpoch == ownerEpoch && t.confirmations >= threshold;
    }

    // ------------------------------------------------------------------ //

    function _confirm(uint256 txId) internal {
        Transaction storage t = _load(txId);
        if (t.executed) revert AlreadyExecuted();
        if (t.ownerEpoch != ownerEpoch) revert StaleProposal(t.ownerEpoch, ownerEpoch);
        if (confirmedBy[txId][msg.sender]) revert AlreadyConfirmed();

        confirmedBy[txId][msg.sender] = true;
        unchecked {
            t.confirmations++;
        }
        emit Confirmed(txId, msg.sender, t.confirmations);
    }

    function _load(uint256 txId) internal view returns (Transaction storage) {
        if (txId >= _transactions.length) revert UnknownTransaction();
        return _transactions[txId];
    }
}
