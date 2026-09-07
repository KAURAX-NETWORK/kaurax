// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title AIAgentRegistry
/// @notice Identity and spending authorization for autonomous agents on KAURAX.
///
/// @dev The registry answers two questions: which address is this agent, and who is
///      allowed to act for it. It does not attest to an agent's behaviour, competence, or
///      to any claim in its metadata.
///
///      This is NOT account abstraction. It does not validate user operations, sponsor
///      gas, or manage session keys. ERC-4337 is not deployed on KAURAX.
contract AIAgentRegistry {
    struct Agent {
        address owner;
        /// @dev The address the agent transacts from.
        address operator;
        string metadataURI;
        /// @dev Cap on what an authorized spender may draw per job through AIPayments.
        uint256 spendLimitPerJob;
        bool active;
        uint64 registeredAt;
    }

    uint256 public agentCount;

    mapping(uint256 => Agent) public agents;
    mapping(address => uint256) internal _agentIdPlusOneByOperator;
    mapping(address => uint256[]) internal _byOwner;

    event AgentRegistered(
        uint256 indexed agentId, address indexed owner, address indexed operator, string metadataURI
    );
    event AgentUpdated(uint256 indexed agentId, string metadataURI, uint256 spendLimitPerJob);
    event AgentActiveChanged(uint256 indexed agentId, bool active);
    event AgentOperatorChanged(uint256 indexed agentId, address indexed previous, address indexed current);

    error NotOwner();
    error UnknownAgent();
    error ZeroAddress();
    error OperatorAlreadyRegistered();

    modifier onlyOwner(uint256 _agentId) {
        if (_agentId >= agentCount) revert UnknownAgent();
        if (agents[_agentId].owner != msg.sender) revert NotOwner();
        _;
    }

    function register(address _operator, string calldata _metadataURI, uint256 _spendLimitPerJob)
        external
        returns (uint256 agentId)
    {
        if (_operator == address(0)) revert ZeroAddress();
        if (_agentIdPlusOneByOperator[_operator] != 0) revert OperatorAlreadyRegistered();

        agentId = agentCount;
        agents[agentId] = Agent({
            owner: msg.sender,
            operator: _operator,
            metadataURI: _metadataURI,
            spendLimitPerJob: _spendLimitPerJob,
            active: true,
            registeredAt: uint64(block.timestamp)
        });
        _agentIdPlusOneByOperator[_operator] = agentId + 1;
        _byOwner[msg.sender].push(agentId);
        agentCount = agentId + 1;

        emit AgentRegistered(agentId, msg.sender, _operator, _metadataURI);
    }

    function update(uint256 _agentId, string calldata _metadataURI, uint256 _spendLimitPerJob)
        external
        onlyOwner(_agentId)
    {
        Agent storage a = agents[_agentId];
        a.metadataURI = _metadataURI;
        a.spendLimitPerJob = _spendLimitPerJob;
        emit AgentUpdated(_agentId, _metadataURI, _spendLimitPerJob);
    }

    function setOperator(uint256 _agentId, address _operator) external onlyOwner(_agentId) {
        if (_operator == address(0)) revert ZeroAddress();
        if (_agentIdPlusOneByOperator[_operator] != 0) revert OperatorAlreadyRegistered();

        Agent storage a = agents[_agentId];
        address previous = a.operator;
        delete _agentIdPlusOneByOperator[previous];
        a.operator = _operator;
        _agentIdPlusOneByOperator[_operator] = _agentId + 1;

        emit AgentOperatorChanged(_agentId, previous, _operator);
    }

    function setActive(uint256 _agentId, bool _active) external onlyOwner(_agentId) {
        agents[_agentId].active = _active;
        emit AgentActiveChanged(_agentId, _active);
    }

    /// @notice The agent an operator address acts for, or reverts if none.
    function agentOf(address _operator) external view returns (uint256) {
        uint256 v = _agentIdPlusOneByOperator[_operator];
        if (v == 0) revert UnknownAgent();
        return v - 1;
    }

    function isAuthorized(address _operator) external view returns (bool) {
        uint256 v = _agentIdPlusOneByOperator[_operator];
        return v != 0 && agents[v - 1].active;
    }

    function agentsOf(address _owner) external view returns (uint256[] memory) {
        return _byOwner[_owner];
    }
}
