# Unyt Core Library (JavaScript)

Includes
 * Unyt core libraries
 * DATEX Runtime for JavaScript
 * DATEX Compiler for JavaScript
 * Unyt default node configurations

## Documentation
 1. [Introduction](./docs/manual/Introduction.md)

## Run Tests
```bash
clear && node ../unyt_tests/run.js tests/
```

## CD
on commit: canary -> dev; done by commit hooks `.git/hooks/post-commit`
on tag: canary -> main

## How to Develop
The main branch is `develop`. This repository uses a workflow like described [here](https://medium.com/trendyol-tech/semantic-versioning-and-gitlab-6bcd1e07c0b0).
To develop a feature, branch of develop and call the branch `feature/YOUR-NAME`. When finished, go to Gitlab > CI > Pipelines > Run Pipeline > select your branch, add a variable called `DEPLOY_TYPE` and `major` or `minor` as value.
This creates a feature branch, and merge request.
When making fixes to a branch (refer to the article), branch off the release branch and do a manual merge request to the branch in question