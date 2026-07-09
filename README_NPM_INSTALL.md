# npm install が止まる場合

この版では package-lock.json の resolved URL を public npm registry に修正しています。

通常は以下で起動できます。

```bash
npm install
npm start
```

まだ npm error `Exit handler never called!` が出る場合は、以下を試してください。

```bash
rm -rf node_modules package-lock.json
npm cache clean --force
npm install --registry=https://registry.npmjs.org/
```
