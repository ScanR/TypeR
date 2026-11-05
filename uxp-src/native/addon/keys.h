// Native keyboard snapshot shared by the UXP bridge and its Windows tests.
// No hooks, worker threads, files, processes, or network connections.
#pragma once
#include <string>

namespace typer {
struct Snapshot {
    bool foreground = false;
    std::string state = "a";
    unsigned mouseDown = 0;
    unsigned mousePressed = 0;
    std::string mouseModifiers;
    bool focusStolen = false;
};

// The top-level window holding the keyboard focus in the foreground thread
// (the root of the focused control), with its owner.
struct FocusWindow {
    bool known = false;
    std::string className;
    unsigned long style = 0;
    unsigned long exStyle = 0;
    std::string ownerClassName;
    bool ownerEnabled = false;
};

// Injected in tests; production uses the current Photoshop process id.
struct Input {
    virtual ~Input() = default;
    virtual bool isHostForeground() const = 0;
    virtual short keyState(int key) const = 0;
    virtual FocusWindow focusWindow() const = 0;
};

// Photoshop's rich tooltips (the contextual task bar's, among others) are
// dialog-class popups shown without WS_EX_NOACTIVATE: on Windows they take
// the keyboard focus, and every shortcut dies until the user clicks the
// document or switches applications. Such a tooltip has no caption, is
// layered and is owned by the still enabled main window. A real dialog,
// Photoshop's (PSFloatC) or UXP's, has a caption and disables its owner.
inline bool isTooltipFocus(const FocusWindow& window) {
    constexpr unsigned long WS_CAPTION_ = 0x00C00000;
    constexpr unsigned long WS_EX_LAYERED_ = 0x00080000;
    constexpr unsigned long WS_EX_NOACTIVATE_ = 0x08000000;
    return window.known && window.className == "#32770" && (window.style & WS_CAPTION_) == 0 &&
        (window.exStyle & WS_EX_LAYERED_) != 0 && (window.exStyle & WS_EX_NOACTIVATE_) == 0 &&
        window.ownerClassName == "Photoshop" && window.ownerEnabled;
}

inline Snapshot readSnapshot(const Input& input) {
    Snapshot result;
    if (!input.isHostForeground()) return result;
    result.foreground = true;
    result.focusStolen = isTooltipFocus(input.focusWindow());
    const auto down = [&](int key) { return (input.keyState(key) & 0x8000) != 0; };
    const bool win = down(0x5B) || down(0x5C);
    const bool ctrl = down(0x11);
    const bool alt = down(0x12);
    const bool shift = down(0x10);
    if (win) { result.state += "WINa"; result.mouseModifiers += "W"; }
    if (ctrl) { result.state += "CTRLa"; result.mouseModifiers += "C"; }
    if (alt) { result.state += "ALTa"; result.mouseModifiers += "A"; }
    if (shift) { result.state += "SHIFTa"; result.mouseModifiers += "S"; }

    static constexpr int namedKeys[] = {
        0x08, 0x09, 0x0D, 0x1B, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E,
        0x6A, 0x6B, 0x6D, 0x6E, 0x6F, 0xBB, 0xBD, 0xBC, 0xBE, 0xBF, 0xBA, 0xDE,
    };
    static constexpr const char* names[] = {
        "BACKSPACE", "TAB", "ENTER", "ESCAPE", "SPACE", "PAGEUP", "PAGEDOWN", "END", "HOME",
        "LEFTaARROWLEFT", "UPaARROWUP", "RIGHTaARROWRIGHT", "DOWNaARROWDOWN", "INSERT", "DELETE",
        "MULTIPLY", "PLUS", "MINUS", "DECIMAL", "DIVIDE", "EQUALaPLUS", "MINUS", "COMMA", "PERIOD",
        "SLASHaDIVIDE", "SEMICOLON", "QUOTEaAPOSTROPHE",
    };
    static_assert(sizeof(namedKeys) / sizeof(*namedKeys) == sizeof(names) / sizeof(*names));
    std::string key;
    for (unsigned i = 0; i < sizeof(namedKeys) / sizeof(*namedKeys); ++i) {
        if (down(namedKeys[i])) { key = names[i]; break; }
    }
    for (int i = 0; key.empty() && i < 24; ++i) if (down(0x70 + i)) key = "F" + std::to_string(i + 1);
    for (int i = 0; key.empty() && i < 10; ++i) if (down(0x60 + i)) key = std::to_string(i);
    for (int vk = 0x30; key.empty() && vk <= 0x5A; ++vk) {
        if ((vk <= 0x39 || vk >= 0x41) && down(vk)) key = static_cast<char>(vk);
    }
    if (!key.empty()) result.state += key + "a";
    // Some mice send their side buttons as the browser's Back and Forward keys
    // (VK_BROWSER_BACK, VK_BROWSER_FORWARD) instead of XBUTTON1/XBUTTON2: they
    // count as mouse buttons 4 and 5 too.
    static constexpr int browserKeys[] = { 0xA6, 0xA7 };
    for (int button = 5; button <= 6; ++button) {
        const short value = static_cast<short>(input.keyState(button) | input.keyState(browserKeys[button - 5]));
        const unsigned bit = 1u << (button - 5);
        if (value & 0x8000) result.mouseDown |= bit;
        // Best effort for a very short click; Windows does not guarantee the low bit.
        if (value & 1) result.mousePressed |= bit;
    }
    // Losing foreground during sampling must never deliver a partial shortcut.
    if (!input.isHostForeground()) return Snapshot{};
    return result;
}

inline std::string serialize(const Snapshot& value) {
    // All strings are generated above from fixed ASCII tokens, never user input.
    return "{\"apiVersion\":1,\"foreground\":" + std::string(value.foreground ? "true" : "false") +
        ",\"state\":\"" + value.state + "\",\"mouseDown\":" + std::to_string(value.mouseDown) +
        ",\"mousePressed\":" + std::to_string(value.mousePressed) +
        ",\"mouseModifiers\":\"" + value.mouseModifiers + "\"" +
        ",\"focusStolen\":" + std::string(value.focusStolen ? "true" : "false") + "}";
}
}
