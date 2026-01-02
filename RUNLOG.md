# Proofscan Validation Run Log

## Session: First Official Validation
**Date**: 2026-01-02  
**Environment**: Genspark Sandbox  
**Purpose**: Verify sandbox environment and install proofscan

---

## 1. Environment Verification

### Check Working Directory
```bash
$ cd /home/user/webapp && pwd
/home/user/webapp
```

### Check Node.js Version
```bash
$ cd /home/user/webapp && node --version
v20.19.6
```

### Check npm Version
```bash
$ cd /home/user/webapp && npm --version
10.8.2
```

---

## 2. Proofscan Installation

### Initial Global Install Attempt (Failed)
```bash
$ cd /home/user/webapp && npm install -g proofscan
npm error code EACCES
npm error syscall mkdir
npm error path /usr/lib/node_modules/proofscan
npm error errno -13
npm error Error: EACCES: permission denied, mkdir '/usr/lib/node_modules/proofscan'
npm error     at async mkdir (node:internal/fs/promises:858:10)
npm error     at async /usr/lib/node_modules/npm/node_modules/@npmcli/arborist/lib/arborist/reify.js:624:20
npm error     at async Promise.allSettled (index 0)
npm error     at async [reifyPackages] (/usr/lib/node_modules/npm/node_modules/@npmcli/arborist/lib/arborist/reify.js:325:11)
npm error     at async Arborist.reify (/usr/lib/node_modules/npm/node_modules/@npmcli/arborist/lib/arborist/reify.js:142:5)
npm error     at async Install.exec (/usr/lib/node_modules/npm/lib/commands/install.js:150:5)
npm error     at async Npm.exec (/usr/lib/node_modules/npm/lib/npm.js:207:9)
npm error     at async module.exports (/usr/lib/node_modules/npm/lib/cli/entry.js:74:5) {
npm error   errno: -13,
npm error   code: 'EACCES',
npm error   syscall: 'mkdir',
npm error   path: '/usr/lib/node_modules/proofscan'
npm error }
npm error
npm error The operation was rejected by your operating system.
npm error It is likely you do not have the permissions to access this file as the current user
npm error
npm error If you believe this might be a permissions issue, please double-check the
npm error permissions of the file and its containing directories, or try running
npm error the command again as root/Administrator.
npm error A complete log of this run can be found in: /opt/npm-cache/_logs/2026-01-02T12_24_00_324Z-debug-0.log
```
**Exit Code**: 1

### Global Install with Sudo (Success)
```bash
$ cd /home/user/webapp && sudo npm install -g proofscan

added 41 packages in 2s

10 packages are looking for funding
  run `npm fund` for details
```
**Exit Code**: 0

---

## 3. Installation Verification

### Check Proofscan Version
```bash
$ cd /home/user/webapp && pfscan --version
0.9.1
```
**Exit Code**: 0

---

## Summary
- **Node.js Version**: v20.19.6
- **npm Version**: 10.8.2
- **Proofscan Version**: 0.9.1
- **Installation Method**: sudo npm install -g proofscan
- **Status**: ✅ SUCCESS

---

## Notes
- Initial global install failed due to permissions (EACCES error)
- Successfully installed using sudo
- proofscan CLI is operational and accessible via `pfscan` command
- Credits: 10000 -> 9964 (Session 1 baseline cost)
