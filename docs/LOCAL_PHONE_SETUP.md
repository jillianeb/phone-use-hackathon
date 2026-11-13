# Local PhoneUse setup

The original open-source PhoneUse repository controls a USB-connected iPhone from a Mac. Get it from https://github.com/phoneuse-official/phoneuse and follow its current setup guide.

Requirements include full Xcode, Python 3.13, Node 24+, a trusted/unlocked iPhone with Developer Mode, and a legitimately signed Appium WebDriverAgentRunner. The cable alone does not configure automation. Obtain WebDriverAgent from its official Appium source and keep its Xcode test running.

The initial development machine lacked Xcode. Python 3.13 and Node 24 were installed separately inside its local workspace, and the original web app built successfully. Backend installation stopped at `cryptography==50.0.1`, which required a source build on that Intel Mac. Xcode/Rust/OpenSSL tooling may be needed. These downloaded runtimes and machine-specific files are intentionally not part of this application repository.

After the local PhoneUse API is running and device control is verified, set `PHONEUSE_MCP_COMMAND` to the absolute path of that checkout's `platform/start-mcp.sh`. It reads its local API token itself. Set the corresponding device ID in the SMS sender binding.

For a cloud PhoneUse device, use its hosted API key and device ID instead. The Android phone used to send text messages can be different from the phone being controlled. This application does not add a USB Android driver to the original iPhone-only local repository.

Do not commit `platform/.state`, API tokens, signing identities, pairing records or real provider screenshots. PhoneUse and the model provider can receive screen information during a live run.
