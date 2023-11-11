# DATEX Core JS

Includes
 * [DATEX](https://github.com/unyt-org/datex-specification) Runtime for JavaScript
 * DATEX Compiler for JavaScript
 * Bindings for built-in JavaScript types

## Documentation

 1. [Introduction](./docs/manual/01%20Introduction.md)
 2. [Important DATEX Concepts](./docs/manual/02%20Important%20DATEX%20Concepts.md)
 3. [Pointers](./docs/manual/03%20Pointers.md)
 4. [Pointer 20Synchronisation](./docs/manual/04%Pointer%20Synchronisation.md)
 5. [Eternal Pointers](./docs/manual/05%20Eternal%20Pointers.md)
 6. [Supranet Networking](./docs/manual/06%20Supranet%20Networking.md)
 7. [Endpoints](./docs/manual/07%20Endpoints.md)
 8. [Public Endpoint Interfaces](./docs/manual/08%20Public%20Endpoint%20Interfaces.md)
 9. [Functional Programming](./docs/manual/09%20Functional%20Programming.md)
 10. [The DATEX API](./docs/manual/10%20The%20DATEX%20API.md)
 11. [Types](./docs/manual/11%20Types.md)
 12. [Classes](./docs/manual/12%20Classes.md)
 13. [Threads](./docs/manual/13%20Threads.md)

## Run Tests
```bash
deno task test
```

## CD
on commit: canary -> dev; done by commit hooks `.git/hooks/post-commit`
on tag: canary -> main

## How to Develop
The main branch is `develop`. This repository uses a workflow like described [here](https://medium.com/trendyol-tech/semantic-versioning-and-gitlab-6bcd1e07c0b0).
To develop a feature, branch of develop and call the branch `feature/YOUR-NAME`. When finished, go to Gitlab > CI > Pipelines > Run Pipeline > select your branch, add a variable called `DEPLOY_TYPE` and `major` or `minor` as value.
This creates a feature branch, and merge request.
When making fixes to a branch (refer to the article), branch off the release branch and do a manual merge request to the branch in question
