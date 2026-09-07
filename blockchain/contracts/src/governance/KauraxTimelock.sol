// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title KauraxTimelock
/// @notice Enforces a waiting period between scheduling a privileged action and executing it.
///
/// @dev A multisig removes the single-key risk but not the *surprise* risk: m signers can
///      still change the system instantly, and users have no window in which to react. The
///      timelock is what turns "we can be overruled" into "we can be overruled, but not
///      without warning".
///
///      What that buys concretely: if the owning multisig is compromised, or decides to
///      change the bridge's rules, every user has at least `delay` to withdraw first.
///
///      Two roles:
///        * **proposer** schedules and cancels. Normally the governance multisig.
///        * **executor** runs an operation once its delay has elapsed. Setting this to
///          address(0) makes execution permissionless, which is usually what you want —
///          a scheduled, publicly visible operation should not also depend on the proposer
///          being available to run it.
///
///      The emergency path is deliberately narrow: `guardianCancel` lets a separate
///      guardian cancel a pending operation, but there is no mechanism to *shorten* a
///      delay. Nothing can be rushed through.
contract KauraxTimelock {
    enum State {
        Unset,
        Pending,
        Ready,
        Done
    }

    /// @notice Minimum delay this timelock will ever accept, fixed at deployment.
    uint256 public immutable MINIMUM_DELAY;

    /// @notice Current delay. Changing it goes through the timelock itself.
    uint256 public delay;

    address public proposer;
    /// @dev address(0) means anyone may execute a ready operation.
    address public executor;
    /// @dev May cancel a pending operation. Cannot schedule or execute.
    address public guardian;

    /// @notice operationId => timestamp at which it becomes executable. 0 = not scheduled.
    mapping(bytes32 => uint256) public readyAt;
    /// @notice operationId => already executed.
    mapping(bytes32 => bool) public executed;

    event Scheduled(
        bytes32 indexed id,
        address indexed target,
        uint256 value,
        bytes data,
        uint256 readyAt,
        string description
    );
    event Executed(bytes32 indexed id, address indexed target, uint256 value, bytes data);
    event Cancelled(bytes32 indexed id, address indexed by);
    event DelayChanged(uint256 previous, uint256 current);
    event ProposerChanged(address indexed previous, address indexed current);
    event ExecutorChanged(address indexed previous, address indexed current);
    event GuardianChanged(address indexed previous, address indexed current);

    error NotProposer();
    error NotExecutor();
    error NotGuardian();
    error NotSelf();
    error ZeroAddress();
    error DelayTooShort(uint256 requested, uint256 minimum);
    error AlreadyScheduled(bytes32 id);
    error NotScheduled(bytes32 id);
    error AlreadyExecuted(bytes32 id);
    error NotReady(bytes32 id, uint256 readyAt, uint256 nowTs);
    error ExecutionReverted(bytes memory_);

    modifier onlyProposer() {
        if (msg.sender != proposer) revert NotProposer();
        _;
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    constructor(
        uint256 minimumDelay,
        uint256 initialDelay,
        address proposer_,
        address executor_,
        address guardian_
    ) {
        if (proposer_ == address(0)) revert ZeroAddress();
        if (initialDelay < minimumDelay) revert DelayTooShort(initialDelay, minimumDelay);

        MINIMUM_DELAY = minimumDelay;
        delay = initialDelay;
        proposer = proposer_;
        executor = executor_; // may be address(0) for permissionless execution
        guardian = guardian_;

        emit DelayChanged(0, initialDelay);
        emit ProposerChanged(address(0), proposer_);
        emit ExecutorChanged(address(0), executor_);
        emit GuardianChanged(address(0), guardian_);
    }

    receive() external payable {}

    // ------------------------------------------------------------------ //

    /// @notice Deterministic id for an operation. Salt distinguishes identical calls.
    function operationId(address target, uint256 value, bytes memory data, bytes32 salt)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(target, value, data, salt));
    }

    function schedule(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 salt,
        string calldata description
    ) external onlyProposer returns (bytes32 id) {
        if (target == address(0)) revert ZeroAddress();

        id = operationId(target, value, data, salt);
        if (readyAt[id] != 0) revert AlreadyScheduled(id);
        if (executed[id]) revert AlreadyExecuted(id);

        uint256 ready = block.timestamp + delay;
        readyAt[id] = ready;

        emit Scheduled(id, target, value, data, ready, description);
    }

    function execute(address target, uint256 value, bytes calldata data, bytes32 salt)
        external
        payable
        returns (bytes memory result)
    {
        // address(0) executor means anyone may run a ready operation. That is deliberate:
        // an operation that has been public for `delay` should not also require the
        // proposer to still be around.
        if (executor != address(0) && msg.sender != executor) revert NotExecutor();

        bytes32 id = operationId(target, value, data, salt);
        uint256 ready = readyAt[id];

        if (ready == 0) revert NotScheduled(id);
        if (executed[id]) revert AlreadyExecuted(id);
        if (block.timestamp < ready) revert NotReady(id, ready, block.timestamp);

        // Effects before the call.
        executed[id] = true;
        delete readyAt[id];

        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) revert ExecutionReverted(ret);

        emit Executed(id, target, value, data);
        return ret;
    }

    /// @notice Cancel a pending operation. Proposer or guardian.
    function cancel(address target, uint256 value, bytes calldata data, bytes32 salt) external {
        if (msg.sender != proposer && msg.sender != guardian) revert NotProposer();

        bytes32 id = operationId(target, value, data, salt);
        if (readyAt[id] == 0) revert NotScheduled(id);
        if (executed[id]) revert AlreadyExecuted(id);

        delete readyAt[id];
        emit Cancelled(id, msg.sender);
    }

    // ------------------------------------------------------------------ //
    //                        Self-administration                         //
    // ------------------------------------------------------------------ //
    // Each of these must itself be scheduled and wait out the delay. The delay cannot be
    // shortened without first waiting the current delay, so there is no way to rush a
    // change through by first reducing the wait.

    function setDelay(uint256 newDelay) external onlySelf {
        if (newDelay < MINIMUM_DELAY) revert DelayTooShort(newDelay, MINIMUM_DELAY);
        emit DelayChanged(delay, newDelay);
        delay = newDelay;
    }

    function setProposer(address newProposer) external onlySelf {
        if (newProposer == address(0)) revert ZeroAddress();
        emit ProposerChanged(proposer, newProposer);
        proposer = newProposer;
    }

    function setExecutor(address newExecutor) external onlySelf {
        emit ExecutorChanged(executor, newExecutor);
        executor = newExecutor;
    }

    function setGuardian(address newGuardian) external onlySelf {
        emit GuardianChanged(guardian, newGuardian);
        guardian = newGuardian;
    }

    // ------------------------------------------------------------------ //

    function stateOf(address target, uint256 value, bytes calldata data, bytes32 salt)
        external
        view
        returns (State)
    {
        bytes32 id = operationId(target, value, data, salt);
        if (executed[id]) return State.Done;
        uint256 ready = readyAt[id];
        if (ready == 0) return State.Unset;
        return block.timestamp >= ready ? State.Ready : State.Pending;
    }

    /// @notice Seconds until an operation becomes executable. 0 once ready.
    function timeUntilReady(address target, uint256 value, bytes calldata data, bytes32 salt)
        external
        view
        returns (uint256)
    {
        uint256 ready = readyAt[operationId(target, value, data, salt)];
        if (ready == 0 || block.timestamp >= ready) return 0;
        return ready - block.timestamp;
    }
}
