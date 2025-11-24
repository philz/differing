# differing

`differing` is a stand-alone code review tool. I use it to review
changes from LLM-based coding agents. It borrows from work
I did on [sketch.dev](https://sketch.dev/)'s code review tool.

This is largely vibe-coded, but I've reviewed it.

The implementation uses Monaco's diff view, and allows
you to accumulate comments which you can paste into your
favorite agent.

![differing screenshot](screenshot.png)

## Installation

### Pre-Built Binaries (MacOS/Linux)

```bash
curl -Lo differing "https://github.com/philz/differing/releases/latest/download/differing_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')" && chmod +x differing
```

The binaries are on the [releases page](https://github.com/philz/differing/releases/latest).

### Homebrew (macOS/Linux)

```bash
brew install philz/tap/differing
```

### Build from Source

You'll need Go and Node.

```bash
git clone https://github.com/philz/differing.git
cd differing
make
```

## Releases

New releases are automatically created on every commit to `main`. Versions
follow the pattern `v0.0.N` where N is the total commit count.

## License

MIT License
