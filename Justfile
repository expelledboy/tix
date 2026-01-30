[private]
default:
	@just --list --unsorted

# Ready dev environment
init:
	pnpm install

# Run the tests
test:
	pnpm jest

# Format the code
format:
	pnpm prettier --write .
