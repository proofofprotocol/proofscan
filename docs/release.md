# NPM OIDC Trusted Publishing 設定まとめ

## 症状

GitHub Actions から `npm publish --provenance` を実行すると失敗する。

```
npm notice Access token expired or revoked. Please try logging in again.
npm error 404 Not Found - PUT https://registry.npmjs.org/proofscan - Not found
```

## 原因

GitHub Actions runner の npm バージョンが古い。

- `ubuntu-latest` + Node 20 環境では **npm 10.x** が入っていることがある
- OIDC Trusted Publishing に必要な npm バージョン要件を満たしていなかった
- ✅ 対処：**npm を 11.5.1+ に更新**

## 解決策（GitHub Actions）

`.github/workflows/release.yml` に npm 更新ステップを追加する。

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "20"
    registry-url: "https://registry.npmjs.org"

# npm 11.5.1+ required for OIDC trusted publishing
- run: npm install -g npm@latest

- run: npm ci
- run: npm test --if-present
- run: npm publish --access public --provenance
```

## npm 側の必要設定

### Settings → Trusted Publisher

- **Publisher**: GitHub Actions
- **Organization/user**: `proofofprotocol`
- **Repository**: `proofscan`
- **Workflow filename**: `release.yml`
- **「パッケージ設定の更新」ボタンを押して保存**

### Settings → Publishing access

- **Require two-factor authentication and disallow tokens (recommended)**

## GitHub Actions 側の必要設定

workflow に OIDC 用 permission を付与する。

```yaml
permissions:
  contents: read
  id-token: write
```

## 再発防止チェックリスト

- [ ] npm の Trusted Publisher に登録した workflow filename と、実際に動く workflow が一致している（例：`release.yml`）
- [ ] workflow に `permissions: id-token: write` がある
- [ ] runner の npm が 11.5.1+（`npm -v` をログに出しても良い）
- [ ] `npm publish` は tag push でのみ走る（意図しない publish を防ぐ）

## 追加でおすすめ（デバッグ用）

一回安定するまで、publish 前にこれを入れると確認が速い：

```yaml
- run: npm -v
```

## リリース手順

```bash
# 1. バージョン更新
# package.json と src/cli.ts の version を更新

# 2. コミット & プッシュ
git add -A
git commit -m "v0.x.x: release description"
git push origin main

# 3. タグ作成 & プッシュ（これで自動 publish）
git tag v0.x.x
git push origin v0.x.x
```

## 参考

- [Problems with trusted publishing -- 404 on publish](https://github.com/orgs/community/discussions/173102)
