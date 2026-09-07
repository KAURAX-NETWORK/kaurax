// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title DeployGuard
/// @notice Refuses to hand a privileged role to an address that is not a live contract.
///
/// @dev This library exists because of a specific, recoverable-only-by-luck mistake.
///
///      `forge script` prints the addresses a deployment *would* have used, taken from its
///      simulation, and it prints them even when the broadcast later reverts. Those
///      addresses hold no code. Reading one from a failed run's output and assigning a role
///      to it points that role at nothing — and because every role in this system may only
///      be rotated by its current holder, the role is then unrecoverable. It happened here:
///      the portal guardian, the batch inbox owner and the dispute game guardian were all
///      pointed at an address from a reverted run, and were only recovered because the chain
///      was a devnet that could be redeployed.
///
///      A mainnet would not have offered that. So the check is mechanical rather than a
///      matter of remembering: assigning a role goes through here, and an address with no
///      code stops the transaction.
///
///      What this does NOT check, and cannot: that the code at the address is the contract
///      you meant. A guardian pointed at the wrong live contract is still wrong. Verifying
///      identity is the operator's job, and `docs/TESTNET.md` says so.
library DeployGuard {
    error NotAContract(address target, string role);
    error ZeroAddress(string role);

    /// @notice Reverts unless `_target` is a contract.
    /// @param _target The address about to receive a role.
    /// @param _role What it is being given, for a legible revert.
    function mustHaveCode(address _target, string memory _role) internal view {
        if (_target == address(0)) revert ZeroAddress(_role);
        if (_target.code.length == 0) revert NotAContract(_target, _role);
    }

    /// @notice True when `_target` holds code.
    /// @dev Offered for scripts that want to branch rather than revert.
    function hasCode(address _target) internal view returns (bool) {
        return _target != address(0) && _target.code.length > 0;
    }

    /// @notice Reverts unless a freshly deployed contract actually exists.
    /// @dev Called immediately after a `new` in a deployment script. In simulation this
    ///      always passes; its value is that the same script run with --broadcast fails
    ///      loudly if the deployment did not take, rather than continuing to wire up an
    ///      address that is about to be discarded.
    function mustBeDeployed(address _deployed, string memory _what) internal view {
        if (_deployed == address(0) || _deployed.code.length == 0) {
            revert NotAContract(_deployed, _what);
        }
    }
}
