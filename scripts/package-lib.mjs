export function validatePackageFiles(files) {
  const allowedRoots = ['dist/', 'README.md', 'LICENSE', 'package.json'];
  const unexpected = files.filter(file => !allowedRoots.some(prefix => prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix));
  const required = ['README.md', 'LICENSE', 'package.json'];
  const missing = required.filter(file => !files.includes(file));
  return { passed: unexpected.length === 0 && missing.length === 0, unexpected, missing };
}
