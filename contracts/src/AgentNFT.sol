// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Enstabler Agent iNFT (ERC-7857-inspired)
/// @notice Each token represents one instance of the Enstabler agent. The
/// metadata (agent config + entity labels) lives on 0G Storage; the token
/// holds the Merkle root pointer plus a model descriptor and version tag.
/// Mint is permissionless so any user can spin up their own agent identity.
/// updateMetadata is owner-gated so the on-chain pointer can track the
/// agent's evolving config.
contract AgentNFT {
    string public constant name = "Enstabler Agent";
    string public constant symbol = "ENSTBL";

    struct AgentMetadata {
        bytes32 storageRootHash;   // 0G Storage Merkle root of the identity blob
        string modelDescriptor;    // e.g., "enstabler-heuristic-v1"
        string versionTag;         // semver of the agent code
        uint256 mintedAt;
        uint256 lastUpdatedAt;
    }

    mapping(uint256 => address) private _owners;
    mapping(uint256 => AgentMetadata) public metadata;
    mapping(address => uint256) public tokenOf;  // first token minted by this address (idempotency anchor)

    uint256 public totalSupply;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event AgentMinted(
        uint256 indexed tokenId,
        address indexed owner,
        bytes32 storageRootHash,
        string modelDescriptor,
        string versionTag
    );
    event AgentMetadataUpdated(
        uint256 indexed tokenId,
        bytes32 oldRootHash,
        bytes32 newRootHash,
        string newVersionTag
    );

    function ownerOf(uint256 tokenId) external view returns (address) {
        require(_owners[tokenId] != address(0), "nonexistent");
        return _owners[tokenId];
    }

    function balanceOf(address holder) external view returns (uint256) {
        return tokenOf[holder] == 0 ? 0 : 1;
    }

    function mint(
        bytes32 _storageRootHash,
        string calldata _modelDescriptor,
        string calldata _versionTag
    ) external returns (uint256) {
        require(tokenOf[msg.sender] == 0, "already minted");
        uint256 tokenId = ++totalSupply;
        _owners[tokenId] = msg.sender;
        tokenOf[msg.sender] = tokenId;
        metadata[tokenId] = AgentMetadata({
            storageRootHash: _storageRootHash,
            modelDescriptor: _modelDescriptor,
            versionTag: _versionTag,
            mintedAt: block.timestamp,
            lastUpdatedAt: block.timestamp
        });
        emit Transfer(address(0), msg.sender, tokenId);
        emit AgentMinted(tokenId, msg.sender, _storageRootHash, _modelDescriptor, _versionTag);
        return tokenId;
    }

    function updateMetadata(
        uint256 tokenId,
        bytes32 _newStorageRootHash,
        string calldata _newVersionTag
    ) external {
        require(_owners[tokenId] == msg.sender, "not owner");
        AgentMetadata storage m = metadata[tokenId];
        bytes32 old = m.storageRootHash;
        m.storageRootHash = _newStorageRootHash;
        m.versionTag = _newVersionTag;
        m.lastUpdatedAt = block.timestamp;
        emit AgentMetadataUpdated(tokenId, old, _newStorageRootHash, _newVersionTag);
    }
}
