# Dotenv Vault Diff Action

This GitHub Action checks for changes in the `.env.vault` file and comments on pull requests with the latest versions of changed environments.

## Features

- Detects changes in the `.env.vault` file
- Comments on PRs with the latest versions of changed environments
- Updates existing comments if rerun

## Usage

Add the following step to your workflow:

```yaml
- name: Dotenv Vault Diff
  uses: high-country-dev/dotenv-vault-diff-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    dotenv-me: ${{ secrets.DOTENV_ME }}
```

## Inputs

- `github-token`: The GitHub token used to create/update comments (required)
- `dotenv-me`: Your DOTENV_ME secret for authentication with dotenv-vault (required)

## Setup

1. Install dependencies: `npm install`
2. Build the action: `npm run build`

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.

## Running this locally

PR_NUMBER=13 GITHUB_REPOSITORY="High-Country-Dev/farmers" GITHUB_BASE_REF=dev DOTENV_ME=me_x GITHUB_TOKEN=ghp_x node ../dotenv-vault-diff/dist/index.js
