// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Per-account key/value storage. Exercises mappings, events and logs, which is
///         what an indexer or explorer integration should be tested against.
contract SimpleStorage {
    mapping(address => mapping(bytes32 => bytes32)) private _store;

    event ValueSet(address indexed owner, bytes32 indexed key, bytes32 value);

    function set(bytes32 _key, bytes32 _value) external {
        _store[msg.sender][_key] = _value;
        emit ValueSet(msg.sender, _key, _value);
    }

    function get(bytes32 _key) external view returns (bytes32) {
        return _store[msg.sender][_key];
    }

    function getFor(address _owner, bytes32 _key) external view returns (bytes32) {
        return _store[_owner][_key];
    }
}
