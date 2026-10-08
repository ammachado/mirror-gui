import fs from 'fs';
import path from 'path';

const fsp = fs.promises;

export interface ArtifactEntry {
  name: string;
  size: number;
  modifiedAt: string;
}

/**
 * An artifact name must address a single top-level entry of the mirror destination:
 * no separators, no traversal, no dotfiles (such as the `.test-write` probe file).
 */
export function isValidArtifactName(name: string): boolean {
  return name.length > 0
    && path.basename(name) === name
    && !name.startsWith('.')
    && !/[\\/\0]/.test(name);
}

/**
 * Lists the top-level regular files of a mirror destination (in practice the
 * mirror_*.tar archives). Directories such as working-dir/, symlinks, and dotfiles
 * are skipped. A destination that no longer exists yields an empty list.
 */
export async function listArtifacts(dir: string): Promise<ArtifactEntry[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const artifacts: ArtifactEntry[] = [];
  for (const entry of entries) {
    // Dirent types come from lstat, so symlinks are not reported as files.
    if (!entry.isFile() || !isValidArtifactName(entry.name)) continue;
    try {
      const stat = await fsp.stat(path.join(dir, entry.name));
      artifacts.push({ name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString() });
    } catch (error: unknown) {
      // The file may have been removed between readdir and stat.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
  return artifacts.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolves an artifact name to an absolute path inside `dir`, or null when the name
 * is invalid, escapes the directory, or does not point at a regular file.
 */
export async function resolveArtifactPath(dir: string, name: string): Promise<string | null> {
  if (!isValidArtifactName(name)) return null;

  const root = path.resolve(dir);
  const candidate = path.resolve(root, name);
  if (!candidate.startsWith(root + path.sep)) return null;

  try {
    const stat = await fsp.lstat(candidate);
    return stat.isFile() ? candidate : null;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}
