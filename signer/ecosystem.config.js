module.exports = {
  apps: [
    {
      name: "signer",
      script: "./src/signer.js",
      node_args: "--max-old-space-size=256",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
}
