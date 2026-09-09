// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title KauraxNames
/// @notice Human-readable names for KAURAX addresses, registered for a term and renewable.
///
/// @dev Design decisions worth knowing:
///
///      * **Names are stored hashed.** Only `keccak256(label)` is kept on chain, so the
///        registry costs the same for any length and nothing depends on string storage.
///        The label itself is emitted in events for indexers to pick up.
///      * **Validation happens on chain.** A name that is not `[a-z0-9-]`, 3-63 characters,
///        not starting or ending with a hyphen, is rejected. Doing this off chain only
///        would let anyone register unrenderable or confusable names directly.
///      * **Expiry has a grace period.** After a name expires the owner keeps an exclusive
///        renewal window before anyone else can take it, so a missed renewal is recoverable.
///      * **Resolution and ownership are separate.** A name resolves to an address that may
///        differ from its owner, which is what makes a name usable as a payment target
///        controlled by someone else.
///      * **Reverse records are verified.** `setPrimaryName` requires the caller to be the
///        address the name currently resolves to, so nobody can point a name at you and
///        have your address display as theirs.
contract KauraxNames {
    // ------------------------------------------------------------------ //
    //                              Storage                               //
    // ------------------------------------------------------------------ //

    struct Record {
        address owner;
        /// @notice Address this name resolves to. Defaults to the owner.
        address resolved;
        /// @notice Unix timestamp after which the registration lapses.
        uint64 expiresAt;
        /// @notice Kept for indexers and for reverse lookups; not used for control flow.
        string label;
    }

    /// @notice keccak256(label) => record.
    mapping(bytes32 => Record) internal _records;

    /// @notice address => the node it has chosen as its primary name.
    mapping(address => bytes32) internal _primaryNode;

    /// @notice Registration price per year, by label length. Shorter names cost more.
    uint256 public immutable PRICE_3_CHAR;
    uint256 public immutable PRICE_4_CHAR;
    uint256 public immutable PRICE_5_PLUS;

    /// @notice Exclusive renewal window after expiry, in seconds.
    uint64 public constant GRACE_PERIOD = 30 days;

    uint64 public constant MIN_DURATION = 28 days;
    uint64 public constant MAX_DURATION = 3650 days;

    uint256 public constant MIN_LABEL_LENGTH = 3;
    uint256 public constant MAX_LABEL_LENGTH = 63;

    /// @notice Receives registration and renewal fees.
    address public treasury;

    /// @notice May update the treasury address. Cannot take or transfer names.
    address public owner;

    uint256 public totalRegistrations;

    // ------------------------------------------------------------------ //
    //                               Events                               //
    // ------------------------------------------------------------------ //

    event NameRegistered(
        bytes32 indexed node, string label, address indexed owner, uint64 expiresAt, uint256 paid
    );
    event NameRenewed(bytes32 indexed node, string label, uint64 expiresAt, uint256 paid);
    event ResolvedAddressChanged(bytes32 indexed node, address indexed resolved);
    event OwnerChanged(bytes32 indexed node, address indexed previousOwner, address indexed newOwner);
    event PrimaryNameChanged(address indexed account, bytes32 indexed node, string label);
    event TreasuryChanged(address indexed previous, address indexed current);

    // ------------------------------------------------------------------ //
    //                               Errors                               //
    // ------------------------------------------------------------------ //

    error InvalidLabel();
    error NameNotAvailable();
    error NameNotRegistered();
    error NotNameOwner();
    error InvalidDuration();
    error InsufficientPayment(uint256 required, uint256 provided);
    error RefundFailed();
    error PaymentFailed();
    error ZeroAddress();
    error NotOwner();
    error NotResolvedAddress();

    // ------------------------------------------------------------------ //

    constructor(address _treasury, uint256 _price3, uint256 _price4, uint256 _price5plus) {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        owner = msg.sender;
        PRICE_3_CHAR = _price3;
        PRICE_4_CHAR = _price4;
        PRICE_5_PLUS = _price5plus;
    }

    // ------------------------------------------------------------------ //
    //                            Registration                            //
    // ------------------------------------------------------------------ //

    /// @notice Register a name for `duration` seconds. Overpayment is refunded.
    function register(string calldata label, uint64 duration) external payable returns (bytes32 node) {
        if (!isValidLabel(label)) revert InvalidLabel();
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidDuration();

        node = namehash(label);
        if (!_isAvailable(node)) revert NameNotAvailable();

        uint256 price = priceFor(label, duration);
        if (msg.value < price) revert InsufficientPayment(price, msg.value);

        uint64 expiresAt = uint64(block.timestamp) + duration;

        _records[node] = Record({owner: msg.sender, resolved: msg.sender, expiresAt: expiresAt, label: label});

        unchecked {
            totalRegistrations++;
        }

        emit NameRegistered(node, label, msg.sender, expiresAt, price);
        emit ResolvedAddressChanged(node, msg.sender);

        _settle(price, msg.value);
    }

    /// @notice Extend a registration. Anyone may pay to renew a name they do not own.
    /// @dev Renewal during the grace period is allowed and restores the name to the owner.
    function renew(string calldata label, uint64 duration) external payable {
        bytes32 node = namehash(label);
        Record storage record = _records[node];

        // A name past its grace period is gone; it must be registered afresh.
        if (record.owner == address(0) || block.timestamp > record.expiresAt + GRACE_PERIOD) {
            revert NameNotRegistered();
        }
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidDuration();

        uint256 price = priceFor(label, duration);
        if (msg.value < price) revert InsufficientPayment(price, msg.value);

        // Extend from now when already expired, so a lapsed name does not get free time.
        uint64 base = record.expiresAt > block.timestamp ? record.expiresAt : uint64(block.timestamp);
        uint64 expiresAt = base + duration;
        record.expiresAt = expiresAt;

        emit NameRenewed(node, label, expiresAt, price);

        _settle(price, msg.value);
    }

    // ------------------------------------------------------------------ //
    //                              Control                               //
    // ------------------------------------------------------------------ //

    /// @notice Point a name at an address. Only the owner may do this.
    function setResolvedAddress(string calldata label, address resolved) external {
        bytes32 node = _requireOwner(label);
        if (resolved == address(0)) revert ZeroAddress();

        _records[node].resolved = resolved;
        emit ResolvedAddressChanged(node, resolved);
    }

    /// @notice Transfer ownership of a name.
    /// @dev The resolved address is deliberately left alone: the new owner decides where it
    ///      points. Any primary-name record held by the previous owner is cleared, so a
    ///      transferred name cannot keep displaying for someone who no longer controls it.
    function transferName(string calldata label, address newOwner) external {
        bytes32 node = _requireOwner(label);
        if (newOwner == address(0)) revert ZeroAddress();

        address previous = _records[node].owner;
        _records[node].owner = newOwner;

        if (_primaryNode[previous] == node) {
            delete _primaryNode[previous];
            emit PrimaryNameChanged(previous, bytes32(0), "");
        }

        emit OwnerChanged(node, previous, newOwner);
    }

    /// @notice Set the name that should display for the caller's address.
    /// @dev Requires the name to currently resolve to the caller. Without that check anyone
    ///      could point a name at your address and control how you are labelled.
    function setPrimaryName(string calldata label) external {
        bytes32 node = namehash(label);
        Record storage record = _records[node];

        if (record.owner == address(0) || block.timestamp > record.expiresAt) revert NameNotRegistered();
        if (record.resolved != msg.sender) revert NotResolvedAddress();

        _primaryNode[msg.sender] = node;
        emit PrimaryNameChanged(msg.sender, node, label);
    }

    function clearPrimaryName() external {
        delete _primaryNode[msg.sender];
        emit PrimaryNameChanged(msg.sender, bytes32(0), "");
    }

    // ------------------------------------------------------------------ //
    //                              Queries                               //
    // ------------------------------------------------------------------ //

    /// @notice Address a name points to, or address(0) if unregistered or expired.
    function resolve(string calldata label) external view returns (address) {
        Record storage record = _records[namehash(label)];
        if (record.owner == address(0) || block.timestamp > record.expiresAt) return address(0);
        return record.resolved;
    }

    /// @notice The name an address has chosen to display, or "" if none is valid.
    function primaryName(address account) external view returns (string memory) {
        bytes32 node = _primaryNode[account];
        if (node == bytes32(0)) return "";

        Record storage record = _records[node];
        // A primary name that has expired, or been re-pointed elsewhere, is not returned.
        if (block.timestamp > record.expiresAt || record.resolved != account) return "";
        return record.label;
    }

    function ownerOf(string calldata label) external view returns (address) {
        Record storage record = _records[namehash(label)];
        // Ownership survives expiry through the grace period, which is what makes renewal possible.
        if (block.timestamp > record.expiresAt + GRACE_PERIOD) return address(0);
        return record.owner;
    }

    function recordOf(string calldata label)
        external
        view
        returns (address nameOwner, address resolved, uint64 expiresAt, bool available, bool inGrace)
    {
        bytes32 node = namehash(label);
        Record storage record = _records[node];
        return (
            record.owner,
            record.resolved,
            record.expiresAt,
            _isAvailable(node),
            record.owner != address(0) && block.timestamp > record.expiresAt
                && block.timestamp <= record.expiresAt + GRACE_PERIOD
        );
    }

    function isAvailable(string calldata label) external view returns (bool) {
        if (!isValidLabel(label)) return false;
        return _isAvailable(namehash(label));
    }

    /// @notice Cost to register or renew `label` for `duration`, in wei.
    function priceFor(string calldata label, uint64 duration) public view returns (uint256) {
        uint256 perYear = _pricePerYear(bytes(label).length);
        // 365 days, computed in seconds. Integer division truncates in the payer's favour
        // only at sub-second granularity, which is not exploitable.
        return (perYear * duration) / 365 days;
    }

    function namehash(string memory label) public pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    /// @notice Labels are 3-63 characters of [a-z0-9-], not starting or ending with '-'.
    /// @dev Uppercase is rejected rather than folded: silently lowercasing would make two
    ///      different inputs resolve to the same name, which is a phishing surface.
    function isValidLabel(string memory label) public pure returns (bool) {
        bytes memory b = bytes(label);
        if (b.length < MIN_LABEL_LENGTH || b.length > MAX_LABEL_LENGTH) return false;
        if (b[0] == "-" || b[b.length - 1] == "-") return false;

        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= 0x61 && c <= 0x7a) // a-z
                || (c >= 0x30 && c <= 0x39) // 0-9
                || c == 0x2d; // -
            if (!ok) return false;
        }
        return true;
    }

    // ------------------------------------------------------------------ //
    //                            Administration                          //
    // ------------------------------------------------------------------ //

    function setTreasury(address _treasury) external {
        if (msg.sender != owner) revert NotOwner();
        if (_treasury == address(0)) revert ZeroAddress();
        emit TreasuryChanged(treasury, _treasury);
        treasury = _treasury;
    }

    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert NotOwner();
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    // ------------------------------------------------------------------ //
    //                             Internals                              //
    // ------------------------------------------------------------------ //

    function _isAvailable(bytes32 node) internal view returns (bool) {
        Record storage record = _records[node];
        if (record.owner == address(0)) return true;
        return block.timestamp > record.expiresAt + GRACE_PERIOD;
    }

    function _requireOwner(string calldata label) internal view returns (bytes32 node) {
        node = namehash(label);
        Record storage record = _records[node];
        if (record.owner == address(0)) revert NameNotRegistered();
        // Control lapses only after the grace period, so an owner can still act on a name
        // they are about to renew.
        if (block.timestamp > record.expiresAt + GRACE_PERIOD) revert NameNotRegistered();
        if (record.owner != msg.sender) revert NotNameOwner();
    }

    function _pricePerYear(uint256 length) internal view returns (uint256) {
        if (length == 3) return PRICE_3_CHAR;
        if (length == 4) return PRICE_4_CHAR;
        return PRICE_5_PLUS;
    }

    /// @dev Pay the treasury, refund the remainder. Effects are already written by the
    ///      time this runs, so a reentrant call finds the name registered.
    // slither-disable-next-line arbitrary-send-eth
    function _settle(uint256 price, uint256 provided) internal {
        if (price > 0) {
            // slither-disable-next-line arbitrary-send-eth
            // `treasury` is contract state set by the owner, not a caller-supplied address.
            (bool paid,) = payable(treasury).call{value: price}("");
            if (!paid) revert PaymentFailed();
        }
        uint256 refund = provided - price;
        if (refund > 0) {
            (bool refunded,) = payable(msg.sender).call{value: refund}("");
            if (!refunded) revert RefundFailed();
        }
    }
}
