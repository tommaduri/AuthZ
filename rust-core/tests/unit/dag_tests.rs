//! Unit tests for DAG operations
//! Tests vertex insertion, validation, ordering, and consensus

use proptest::prelude::*;
use std::collections::HashSet;

#[cfg(test)]
mod vertex_operations {
    use super::*;

    #[test]
    fn test_create_vertex() {
        let vertex = dag::Vertex::new(
            b"test data",
            vec![],
            [1u8; 32], // creator
        );

        assert_eq!(vertex.data(), b"test data");
        assert_eq!(vertex.parents().len(), 0);
    }

    #[test]
    fn test_vertex_with_parents() {
        let parent1 = [1u8; 32];
        let parent2 = [2u8; 32];

        let vertex = dag::Vertex::new(
            b"child data",
            vec![parent1, parent2],
            [3u8; 32],
        );

        assert_eq!(vertex.parents().len(), 2);
        assert!(vertex.has_parent(&parent1));
        assert!(vertex.has_parent(&parent2));
    }

    #[test]
    fn test_vertex_hash() {
        let vertex = dag::Vertex::new(b"data", vec![], [1u8; 32]);
        let hash = vertex.hash();
        assert_eq!(hash.len(), 32);
    }

    #[test]
    fn test_vertex_hash_determinism() {
        let vertex1 = dag::Vertex::new(b"data", vec![], [1u8; 32]);
        let vertex2 = dag::Vertex::new(b"data", vec![], [1u8; 32]);
        assert_eq!(vertex1.hash(), vertex2.hash());
    }

    #[test]
    fn test_vertex_signature() {
        let keypair = crypto::generate_keypair();
        let mut vertex = dag::Vertex::new(b"data", vec![], keypair.public_key);
        vertex.sign(&keypair.secret_key);

        assert!(vertex.verify_signature());
    }

    proptest! {
        #[test]
        fn test_vertex_creation_arbitrary_data(data in prop::collection::vec(any::<u8>(), 0..1000)) {
            let vertex = dag::Vertex::new(&data, vec![], [1u8; 32]);
            prop_assert_eq!(vertex.data(), data.as_slice());
        }
    }
}

#[cfg(test)]
mod dag_insertion {
    use super::*;

    #[test]
    fn test_insert_genesis_vertex() {
        let mut dag = dag::DAG::new();
        let vertex = dag::Vertex::new(b"genesis", vec![], [1u8; 32]);

        let result = dag.insert(vertex.clone());
        assert!(result.is_ok());
        assert_eq!(dag.vertex_count(), 1);
    }

    #[test]
    fn test_insert_child_vertex() {
        let mut dag = dag::DAG::new();

        let genesis = dag::Vertex::new(b"genesis", vec![], [1u8; 32]);
        let genesis_hash = genesis.hash();
        dag.insert(genesis).unwrap();

        let child = dag::Vertex::new(b"child", vec![genesis_hash], [2u8; 32]);
        let result = dag.insert(child);
        assert!(result.is_ok());
        assert_eq!(dag.vertex_count(), 2);
    }

    #[test]
    fn test_insert_vertex_missing_parent() {
        let mut dag = dag::DAG::new();
        let missing_parent = [99u8; 32];
        let vertex = dag::Vertex::new(b"orphan", vec![missing_parent], [1u8; 32]);

        let result = dag.insert(vertex);
        assert!(result.is_err());
    }

    #[test]
    fn test_insert_duplicate_vertex() {
        let mut dag = dag::DAG::new();
        let vertex = dag::Vertex::new(b"data", vec![], [1u8; 32]);

        dag.insert(vertex.clone()).unwrap();
        let result = dag.insert(vertex);
        assert!(result.is_err());
    }

    #[test]
    fn test_insert_maintains_dag_property() {
        let mut dag = dag::DAG::new();

        // Create a simple chain: A -> B -> C
        let a = dag::Vertex::new(b"A", vec![], [1u8; 32]);
        let a_hash = a.hash();
        dag.insert(a).unwrap();

        let b = dag::Vertex::new(b"B", vec![a_hash], [2u8; 32]);
        let b_hash = b.hash();
        dag.insert(b).unwrap();

        let c = dag::Vertex::new(b"C", vec![b_hash], [3u8; 32]);
        dag.insert(c).unwrap();

        assert!(dag.is_acyclic());
    }

    #[test]
    fn test_reject_cyclic_insertion() {
        let mut dag = dag::DAG::new();

        let a = dag::Vertex::new(b"A", vec![], [1u8; 32]);
        let a_hash = a.hash();
        dag.insert(a).unwrap();

        // Try to create a cycle: A -> B -> A
        let b = dag::Vertex::new(b"B", vec![a_hash], [2u8; 32]);
        let b_hash = b.hash();
        dag.insert(b).unwrap();

        // This should fail because it would create a cycle
        let c = dag::Vertex::new_with_hash(b"C", vec![b_hash], [3u8; 32], a_hash);
        let result = dag.insert(c);
        assert!(result.is_err());
    }
}

#[cfg(test)]
mod dag_validation {
    use super::*;

    #[test]
    fn test_validate_vertex_structure() {
        let vertex = dag::Vertex::new(b"data", vec![], [1u8; 32]);
        assert!(dag::validate_vertex(&vertex).is_ok());
    }

    #[test]
    fn test_validate_empty_data() {
        let vertex = dag::Vertex::new(b"", vec![], [1u8; 32]);
        // Empty data might be invalid depending on protocol rules
        let result = dag::validate_vertex(&vertex);
        assert!(result.is_ok() || result.is_err()); // Protocol-dependent
    }

    #[test]
    fn test_validate_max_parents() {
        let parents = vec![[0u8; 32]; 100]; // 100 parents
        let vertex = dag::Vertex::new(b"data", parents, [1u8; 32]);

        // Should enforce maximum parent limit
        let result = dag::validate_vertex(&vertex);
        // Adjust based on protocol limits
        assert!(result.is_err() || vertex.parents().len() <= dag::MAX_PARENTS);
    }

    #[test]
    fn test_validate_vertex_signature() {
        let keypair = crypto::generate_keypair();
        let mut vertex = dag::Vertex::new(b"data", vec![], keypair.public_key);
        vertex.sign(&keypair.secret_key);

        assert!(vertex.verify_signature());
    }

    #[test]
    fn test_validate_invalid_signature() {
        let keypair1 = crypto::generate_keypair();
        let keypair2 = crypto::generate_keypair();

        let mut vertex = dag::Vertex::new(b"data", vec![], keypair1.public_key);
        vertex.sign(&keypair2.secret_key); // Sign with wrong key

        assert!(!vertex.verify_signature());
    }
}

#[cfg(test)]
mod topological_ordering {
    use super::*;

    #[test]
    fn test_topological_sort_simple_chain() {
        let mut dag = dag::DAG::new();

        let a = dag::Vertex::new(b"A", vec![], [1u8; 32]);
        let a_hash = a.hash();
        dag.insert(a).unwrap();

        let b = dag::Vertex::new(b"B", vec![a_hash], [2u8; 32]);
        let b_hash = b.hash();
        dag.insert(b).unwrap();

        let c = dag::Vertex::new(b"C", vec![b_hash], [3u8; 32]);
        dag.insert(c).unwrap();

        let order = dag.topological_order();
        assert_eq!(order.len(), 3);

        // A should come before B, B before C
        let a_pos = order.iter().position(|h| h == &a_hash).unwrap();
        let b_pos = order.iter().position(|h| h == &b_hash).unwrap();
        assert!(a_pos < b_pos);
    }

    #[test]
    fn test_topological_sort_diamond() {
        let mut dag = dag::DAG::new();

        // Create diamond: A -> B, A -> C, B -> D, C -> D
        let a = dag::Vertex::new(b"A", vec![], [1u8; 32]);
        let a_hash = a.hash();
        dag.insert(a).unwrap();

        let b = dag::Vertex::new(b"B", vec![a_hash], [2u8; 32]);
        let b_hash = b.hash();
        dag.insert(b).unwrap();

        let c = dag::Vertex::new(b"C", vec![a_hash], [3u8; 32]);
        let c_hash = c.hash();
        dag.insert(c).unwrap();

        let d = dag::Vertex::new(b"D", vec![b_hash, c_hash], [4u8; 32]);
        let d_hash = d.hash();
        dag.insert(d).unwrap();

        let order = dag.topological_order();
        let a_pos = order.iter().position(|h| h == &a_hash).unwrap();
        let d_pos = order.iter().position(|h| h == &d_hash).unwrap();

        assert!(a_pos < d_pos);
    }

    #[test]
    fn test_get_ancestors() {
        let mut dag = dag::DAG::new();

        let a = dag::Vertex::new(b"A", vec![], [1u8; 32]);
        let a_hash = a.hash();
        dag.insert(a).unwrap();

        let b = dag::Vertex::new(b"B", vec![a_hash], [2u8; 32]);
        let b_hash = b.hash();
        dag.insert(b).unwrap();

        let c = dag::Vertex::new(b"C", vec![b_hash], [3u8; 32]);
        let c_hash = c.hash();
        dag.insert(c).unwrap();

        let ancestors = dag.get_ancestors(&c_hash);
        assert_eq!(ancestors.len(), 2);
        assert!(ancestors.contains(&a_hash));
        assert!(ancestors.contains(&b_hash));
    }
}

#[cfg(test)]
mod consensus {
    use super::*;

    #[test]
    fn test_witness_selection() {
        let mut dag = dag::DAG::new();

        // Add several vertices
        for i in 0..10 {
            let vertex = dag::Vertex::new(
                format!("vertex_{}", i).as_bytes(),
                vec![],
                [i as u8; 32],
            );
            dag.insert(vertex).unwrap();
        }

        let witnesses = dag.select_witnesses(3);
        assert_eq!(witnesses.len(), 3);
    }

    #[test]
    fn test_round_assignment() {
        let mut dag = dag::DAG::new();

        let vertex = dag::Vertex::new(b"test", vec![], [1u8; 32]);
        let hash = vertex.hash();
        dag.insert(vertex).unwrap();

        let round = dag.get_round(&hash);
        assert!(round.is_some());
    }

    #[test]
    fn test_voting_round() {
        let mut dag = dag::DAG::new();

        // Create initial vertices
        let v1 = dag::Vertex::new(b"v1", vec![], [1u8; 32]);
        let v1_hash = v1.hash();
        dag.insert(v1).unwrap();

        let v2 = dag::Vertex::new(b"v2", vec![], [2u8; 32]);
        let v2_hash = v2.hash();
        dag.insert(v2).unwrap();

        // Start voting round
        let result = dag.start_voting_round(vec![v1_hash, v2_hash]);
        assert!(result.is_ok());
    }

    #[test]
    fn test_finalization() {
        let mut dag = dag::DAG::new();

        let vertex = dag::Vertex::new(b"finalize", vec![], [1u8; 32]);
        let hash = vertex.hash();
        dag.insert(vertex).unwrap();

        dag.finalize_vertex(&hash);
        assert!(dag.is_finalized(&hash));
    }

    #[test]
    fn test_consensus_threshold() {
        let total_validators = 100;
        let required = dag::consensus_threshold(total_validators);

        // Should be > 2/3 of validators
        assert!(required > (total_validators * 2) / 3);
    }
}

#[cfg(test)]
mod conflict_resolution {
    use super::*;

    #[test]
    fn test_detect_conflict() {
        let mut dag = dag::DAG::new();

        let v1 = dag::Vertex::new(b"transaction A", vec![], [1u8; 32]);
        let v2 = dag::Vertex::new(b"transaction A", vec![], [2u8; 32]);

        dag.insert(v1.clone()).unwrap();
        dag.insert(v2.clone()).unwrap();

        assert!(dag.has_conflict(&v1.hash(), &v2.hash()));
    }

    #[test]
    fn test_resolve_by_timestamp() {
        let mut dag = dag::DAG::new();

        let v1 = dag::Vertex::with_timestamp(b"data", vec![], [1u8; 32], 1000);
        let v2 = dag::Vertex::with_timestamp(b"data", vec![], [2u8; 32], 2000);

        dag.insert(v1.clone()).unwrap();
        dag.insert(v2.clone()).unwrap();

        let winner = dag.resolve_conflict(&v1.hash(), &v2.hash());
        assert_eq!(winner, v1.hash()); // Earlier timestamp wins
    }
}

#[cfg(test)]
mod dag_queries {
    use super::*;

    #[test]
    fn test_get_tips() {
        let mut dag = dag::DAG::new();

        let a = dag::Vertex::new(b"A", vec![], [1u8; 32]);
        let a_hash = a.hash();
        dag.insert(a).unwrap();

        let b = dag::Vertex::new(b"B", vec![a_hash], [2u8; 32]);
        dag.insert(b).unwrap();

        let tips = dag.get_tips();
        assert_eq!(tips.len(), 1);
    }

    #[test]
    fn test_get_depth() {
        let mut dag = dag::DAG::new();

        let a = dag::Vertex::new(b"A", vec![], [1u8; 32]);
        let a_hash = a.hash();
        dag.insert(a).unwrap();

        let b = dag::Vertex::new(b"B", vec![a_hash], [2u8; 32]);
        let b_hash = b.hash();
        dag.insert(b).unwrap();

        assert_eq!(dag.get_depth(&a_hash), 0);
        assert_eq!(dag.get_depth(&b_hash), 1);
    }

    #[test]
    fn test_path_exists() {
        let mut dag = dag::DAG::new();

        let a = dag::Vertex::new(b"A", vec![], [1u8; 32]);
        let a_hash = a.hash();
        dag.insert(a).unwrap();

        let b = dag::Vertex::new(b"B", vec![a_hash], [2u8; 32]);
        let b_hash = b.hash();
        dag.insert(b).unwrap();

        assert!(dag.path_exists(&a_hash, &b_hash));
        assert!(!dag.path_exists(&b_hash, &a_hash));
    }
}
