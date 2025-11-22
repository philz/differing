# differing

`differing` is a stand-alone code review tool. I use it to review
changes from LLM-based coding agents. It borrows from work
I did on [sketch.dev](https://sketch.dev/)'s code review tool.

This is largely vibe-coded, but I've reviewed it.

The implementation uses Monaco's diff view, and allows
you to accumulate comments which you can paste into your
favorite agent.

# TODO: Screenshot

## Installation

### Download Pre-built Binaries

Download the latest release for your platform from the [releases page](https://github.com/philz/differing/releases):

**macOS:**
```bash
# Intel Mac
curl -L https://github.com/philz/differing/releases/latest/download/differing_0.1.0_darwin_amd64.tar.gz | tar xz
chmod +x differing

# Apple Silicon Mac
curl -L https://github.com/philz/differing/releases/latest/download/differing_0.1.0_darwin_arm64.tar.gz | tar xz
chmod +x differing
```

**Linux:**
```bash
# x86_64
curl -L https://github.com/philz/differing/releases/latest/download/differing_0.1.0_linux_amd64.tar.gz | tar xz
chmod +x differing

# ARM64
curl -L https://github.com/philz/differing/releases/latest/download/differing_0.1.0_linux_arm64.tar.gz | tar xz
chmod +x differing
```

**Windows:**

Download the appropriate zip file from the [releases page](https://github.com/philz/differing/releases) and extract it.

### Build from Source

If you have Go installed, you can build from source:

```bash
git clone https://github.com/philz/differing.git
cd differing
make
```

## Usage

```bash
./differing
```

Then open your browser to `http://localhost:3844`

### Options

```
-addr string
      listen address (default "localhost")
-port string
      listen port (default "3844")
-open
      automatically open web browser
```

## License

MIT License - feel free to use this as a foundation for your own diff viewing tools!
