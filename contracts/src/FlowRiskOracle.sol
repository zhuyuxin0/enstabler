// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract FlowRiskOracle {
    struct FlowScore {
        address stablecoin;
        uint256 flowHash;
        uint8 riskLevel;         // 0=normal, 1=elevated, 2=suspicious, 3=critical
        string classification;   // "payment" | "arbitrage" | "cex_flow" | "bot" | "suspicious"
        uint256 timestamp;
        bytes32 storageRootHash; // 0G Storage Merkle root
    }

    mapping(uint256 => FlowScore) public scores;
    uint256 public scoreCount;
    address public agent;

    event FlowScored(uint256 indexed scoreId, address stablecoin, uint8 riskLevel, string classification);

    modifier onlyAgent() {
        require(msg.sender == agent, "Only agent");
        _;
    }

    constructor() { agent = msg.sender; }

    function publishScore(
        address _stablecoin, uint256 _flowHash, uint8 _riskLevel,
        string calldata _classification, bytes32 _storageRootHash
    ) external onlyAgent returns (uint256) {
        uint256 id = scoreCount++;
        scores[id] = FlowScore(_stablecoin, _flowHash, _riskLevel, _classification, block.timestamp, _storageRootHash);
        emit FlowScored(id, _stablecoin, _riskLevel, _classification);
        return id;
    }

    function getLatestScore() external view returns (FlowScore memory) {
        require(scoreCount > 0, "No scores");
        return scores[scoreCount - 1];
    }

    function getScoreCount() external view returns (uint256) { return scoreCount; }
}
