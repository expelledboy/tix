# CLI

```
tix build <derivation>.tix
# => creates <derivation>.<version>.tar.gz

tix show <derivation>.<version>.tar.gz
# => basically cat <derivation>.<version>.tar.gz/derivation.json

tix copy <derivation>.<version>.tar.gz ssh://user@host/remote/path
# => basically scp <derivation>.<version>.tar.gz ssh://user@host/remote/path

tix install <derivation>.<version>.tar.gz
# => basically tar -xvf <derivation>.<version>.tar.gz

tix remove <derivation>
```
