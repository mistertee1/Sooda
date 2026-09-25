#!/usr/bin/env python3
"""
Sooda SaaS Platform - Release Packaging Script
Creates a pristine release zip archive with absolute verification that
no runtime database files, local state, or ephemeral artifacts are included.
"""

import os
import sys
import zipfile

EXCLUDED_DIR_NAMES = {
    'node_modules',
    'dist',
    '.git',
    'coverage',
    'build',
    '.cache',
    '__pycache__',
}

EXCLUDED_EXTENSIONS = {
    '.db',
    '.db-journal',
    '.db-wal',
    '.db-shm',
    '.sqlite',
    '.sqlite3',
    '.log',
}

EXCLUDED_FILES = {
    'release.zip',
    '.DS_Store',
}

def should_exclude(rel_path):
    parts = rel_path.split(os.sep)
    for part in parts:
        if part in EXCLUDED_DIR_NAMES:
            return True
    
    file_name = os.path.basename(rel_path)
    if file_name in EXCLUDED_FILES:
        return True

    _, ext = os.path.splitext(file_name)
    if ext.lower() in EXCLUDED_EXTENSIONS:
        return True

    return False

def package_release(output_zip='release.zip'):
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    out_path = os.path.join(root_dir, output_zip)

    if os.path.exists(out_path):
        os.remove(out_path)

    print(f"Creating clean release archive: {output_zip}")
    print(f"Source root: {root_dir}")

    total_files = 0
    excluded_count = 0

    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(root_dir):
            # Prune excluded directories
            dirs[:] = [d for d in dirs if d not in EXCLUDED_DIR_NAMES]

            for file in files:
                abs_path = os.path.join(root, file)
                rel_path = os.path.relpath(abs_path, root_dir)

                if should_exclude(rel_path):
                    excluded_count += 1
                    continue

                zf.write(abs_path, rel_path)
                total_files += 1

    print(f"Archived {total_files} files (excluded {excluded_count} artifacts).")

    # Post-packaging verification
    print("Verifying archive contents against security policies...")
    violations = []
    with zipfile.ZipFile(out_path, 'r') as zf:
        for name in zf.namelist():
            for ext in EXCLUDED_EXTENSIONS:
                if name.lower().endswith(ext):
                    violations.append(f"ILLEGAL DB ARTIFACT: {name}")
            if 'node_modules' in name or name.startswith('dist/'):
                violations.append(f"ILLEGAL BUILD/DEPENDENCY ARTIFACT: {name}")

    if violations:
        print("VERIFICATION FAILED: Violations found in release archive:")
        for v in violations:
            print(f"  ❌ {v}")
        os.remove(out_path)
        sys.exit(1)

    print("VERIFICATION PASSED: Zero database artifacts or ephemeral files in release.zip.")
    print(f"Archive size: {os.path.getsize(out_path)} bytes")

if __name__ == '__main__':
    package_release()
