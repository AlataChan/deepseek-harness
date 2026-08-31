//! Hash-named Client bundle cache matching `cacheVerifiedBundles`.

use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::shell::ShellError;

/// Inputs for one cached Client bundle copy.
pub struct BundleCacheRequest<'a> {
    /// Absolute source path of the announced artifact.
    pub source_path: &'a Path,
    /// Expected SHA-256 hex of the source bytes.
    pub sha256: &'a str,
    /// Ready-graph revision used as the generation directory name.
    pub graph_rev: &'a str,
    /// Zero-based entry index in the ready graph.
    pub index: u32,
    /// Bundle identifier hashed into the file name.
    pub id: &'a str,
}

/// Destination written after a successful cache.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedBundle {
    /// Absolute cached file path.
    pub destination: PathBuf,
    /// Generation directory allowed on the asset-protocol scope.
    pub generation_dir: PathBuf,
    /// WebView `convertFileSrc` equivalent for `destination`.
    pub src: String,
}

/// Hex SHA-256 of a UTF-8 string, matching Node `createHash('sha256').update(value).digest('hex')`.
#[must_use]
pub fn sha256_hex(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

/// Hex SHA-256 of raw bytes.
#[must_use]
pub fn sha256_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Build the same asset URL `convertFileSrc` produces for a local file.
#[must_use]
pub fn asset_src(path: &Path) -> String {
    let encoded = path
        .to_string_lossy()
        .replace('\\', "/")
        .replace(' ', "%20");
    if encoded.starts_with('/') {
        format!("asset://localhost{encoded}")
    } else {
        format!("asset://localhost/{encoded}")
    }
}

fn assert_no_traversal(field: &str, value: &str) -> Result<(), ShellError> {
    if value.split(['/', '\\']).any(|segment| segment == "..") {
        return Err(ShellError::Config(format!(
            "{field} must not contain path traversal"
        )));
    }
    Ok(())
}

/**
 * Copy one verified bundle into `$APP_DATA/bundle-cache/<sha256(graphRev)>`.
 *
 * @param cache_root - application data directory that owns `bundle-cache/`.
 * @param request - source path, hashes, and graph identity.
 */
pub fn cache_bundle(
    cache_root: &Path,
    request: BundleCacheRequest<'_>,
) -> Result<CachedBundle, ShellError> {
    if !request.source_path.is_absolute() {
        return Err(ShellError::Config(
            "bundle source path must be absolute".into(),
        ));
    }
    assert_no_traversal("graphRev", request.graph_rev)?;
    assert_no_traversal("id", request.id)?;

    let bytes = fs::read(request.source_path)
        .map_err(|error| ShellError::Config(format!("bundle source is unreadable: {error}")))?;
    if sha256_bytes(&bytes) != request.sha256 {
        return Err(ShellError::Config("bundle hash mismatch".into()));
    }

    let bundle_cache = cache_root.join("bundle-cache");
    let generation_dir = bundle_cache.join(sha256_hex(request.graph_rev));
    let file_name = format!("{}-{}.js", request.index, &sha256_hex(request.id)[..16]);
    let destination = generation_dir.join(file_name);

    let canonical_root = fs::canonicalize(cache_root).unwrap_or_else(|_| cache_root.to_path_buf());
    fs::create_dir_all(&generation_dir).map_err(|error| {
        ShellError::Config(format!("bundle cache directory is not writable: {error}"))
    })?;
    let canonical_dest_parent = fs::canonicalize(&generation_dir).map_err(|error| {
        ShellError::Config(format!("bundle cache generation is not readable: {error}"))
    })?;
    if !canonical_dest_parent.starts_with(canonical_root.join("bundle-cache")) {
        return Err(ShellError::Config(
            "bundle cache destination escaped bundle-cache".into(),
        ));
    }

    let temporary = generation_dir.join(format!(".{}.tmp", Uuid::new_v4()));
    fs::write(&temporary, bytes)
        .map_err(|error| ShellError::Config(format!("bundle cache write failed: {error}")))?;
    fs::rename(&temporary, &destination)
        .map_err(|error| ShellError::Config(format!("bundle cache publish failed: {error}")))?;

    Ok(CachedBundle {
        src: asset_src(&destination),
        destination,
        generation_dir,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::fs;
    use tempfile::tempdir;

    fn write_source(dir: &Path, contents: &[u8]) -> (PathBuf, String) {
        let path = dir.join("source.js");
        fs::write(&path, contents).expect("write source");
        (path, hex::encode(Sha256::digest(contents)))
    }

    #[test]
    fn refuses_a_relative_source_path() {
        let root = tempdir().expect("tempdir");
        let error = cache_bundle(
            root.path(),
            BundleCacheRequest {
                source_path: Path::new("relative.js"),
                sha256: "00",
                graph_rev: "rev",
                index: 0,
                id: "ui",
            },
        )
        .expect_err("relative path");
        assert!(error.to_string().contains("absolute"));
    }

    #[test]
    fn refuses_a_sha256_mismatch() {
        let root = tempdir().expect("tempdir");
        let (source, _) = write_source(root.path(), b"export {}\n");
        let error = cache_bundle(
            root.path(),
            BundleCacheRequest {
                source_path: &source,
                sha256: "deadbeef",
                graph_rev: "rev",
                index: 0,
                id: "ui",
            },
        )
        .expect_err("hash mismatch");
        assert!(error.to_string().contains("hash mismatch"));
    }

    #[test]
    fn refuses_traversal_in_graph_rev_and_id() {
        let root = tempdir().expect("tempdir");
        let (source, hash) = write_source(root.path(), b"export {}\n");
        let rev = cache_bundle(
            root.path(),
            BundleCacheRequest {
                source_path: &source,
                sha256: &hash,
                graph_rev: "../escape",
                index: 0,
                id: "ui",
            },
        )
        .expect_err("graphRev traversal");
        assert!(rev.to_string().contains("traversal"));
        let id = cache_bundle(
            root.path(),
            BundleCacheRequest {
                source_path: &source,
                sha256: &hash,
                graph_rev: "rev",
                index: 0,
                id: "..\\escape",
            },
        )
        .expect_err("id traversal");
        assert!(id.to_string().contains("traversal"));
    }

    #[test]
    fn writes_the_hashed_cache_layout() {
        let root = tempdir().expect("tempdir");
        let (source, hash) = write_source(root.path(), b"export {}\n");
        let cached = cache_bundle(
            root.path(),
            BundleCacheRequest {
                source_path: &source,
                sha256: &hash,
                graph_rev: "graph-1",
                index: 2,
                id: "@deepseek-ai/dsh-client-web",
            },
        )
        .expect("cache");
        let expected_dir = root.path().join("bundle-cache").join(sha256_hex("graph-1"));
        let expected_name = format!("2-{}.js", &sha256_hex("@deepseek-ai/dsh-client-web")[..16]);
        assert_eq!(cached.generation_dir, expected_dir);
        assert_eq!(cached.destination, expected_dir.join(expected_name));
        assert_eq!(
            fs::read(&cached.destination).expect("read cache"),
            b"export {}\n"
        );
        assert!(cached.src.starts_with("asset://localhost/"));
        assert!(!cached.src.starts_with("asset://localhost//"));
    }

    #[test]
    fn asset_src_keeps_one_slash_after_localhost() {
        assert_eq!(
            asset_src(Path::new("/tmp/file.js")),
            "asset://localhost/tmp/file.js"
        );
    }
}
