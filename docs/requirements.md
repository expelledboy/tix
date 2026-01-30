Fundimentally: The contents of a component depend exclusively on the build inputs.

1. Must install releases as read-only
2. Should be able to install the same dependency multiple times, eg `/store/hello/<hash>-<version>/bin/hello`
3. Installs should be atomic
4. You should be able to roll back to a previous state of the installation
5. Should always be able to build dependencies from source
6. Should have a list of binary caches to pull from
7. Can customize how dependencies are built
8. Have a component package framework that is language agnostic
9. Portability builtin tooling
10. Component hashes must be collision resistant
11. The hash is computed over all inputs (to prevent interference between components and to identify them) including the following:
    - The sources of the components.
    - The script that performed the build.
    - Any arguments or environment variables passed to the build script.
    - All build time dependencies, typically including the compiler, linker, any libraries
      used at build time, standard Unix tools such as cp and tar, the shell, and so on.
