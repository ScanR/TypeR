#include "../../uxp-src/native/addon/keys.h"
#include <array>
#include <cassert>
#include <iostream>

struct FakeInput final : typer::Input {
    bool foreground = true;
    bool loseFocus = false;
    mutable int foregroundChecks = 0;
    mutable int reads = 0;
    std::array<short, 256> keys{};
    typer::FocusWindow focus;
    bool isHostForeground() const override { return foreground && (!loseFocus || foregroundChecks++ == 0); }
    short keyState(int key) const override { ++reads; return keys.at(key); }
    typer::FocusWindow focusWindow() const override { return focus; }
    void down(int key) { keys.at(key) = static_cast<short>(0x8000); }
};

// The contextual task bar's tooltip holding the focus, as seen on Windows 10
// with Photoshop 28: a dialog-class layered popup without a caption, owned by
// the enabled main window.
FakeInput tooltipFocus() {
    FakeInput input;
    input.focus.known = true;
    input.focus.className = "#32770";
    input.focus.style = 0x94000004;
    input.focus.exStyle = 0x00090000;
    input.focus.ownerClassName = "Photoshop";
    input.focus.ownerEnabled = true;
    return input;
}

int main() {
    FakeInput input;
    input.foreground = false;
    input.down(0x4B);
    assert(typer::readSnapshot(input).state == "a");
    assert(input.reads == 0); // Never read even modifiers or mouse outside Photoshop.
    input.foreground = true;
    input.down(0x11);
    assert(typer::readSnapshot(input).state == "aCTRLaKa");
    input.down(0x5B); input.down(0x12); input.down(0x10);
    input.keys[5] = static_cast<short>(0x8001);
    input.keys[6] = 1;
    auto value = typer::readSnapshot(input);
    assert(value.state == "aWINaCTRLaALTaSHIFTaKa");
    assert(value.mouseModifiers == "WCAS");
    assert(value.mouseDown == 1 && value.mousePressed == 3);
    input.loseFocus = true;
    value = typer::readSnapshot(input);
    assert(!value.foreground && value.state == "a" && value.mouseDown == 0);

    const std::pair<int, const char*> examples[] = {
        {0x25, "LEFTaARROWLEFT"}, {0x26, "UPaARROWUP"}, {0x27, "RIGHTaARROWRIGHT"}, {0x28, "DOWNaARROWDOWN"},
        {0x0D, "ENTER"}, {0x1B, "ESCAPE"}, {0x20, "SPACE"}, {0x6B, "PLUS"},
        {0xBB, "EQUALaPLUS"}, {0xDE, "QUOTEaAPOSTROPHE"}, {0xBF, "SLASHaDIVIDE"},
    };
    for (const auto& example : examples) {
        FakeInput key;
        key.down(example.first);
        assert(typer::readSnapshot(key).state == std::string("a") + example.second + "a");
    }
    for (int i = 0; i < 24; ++i) {
        FakeInput key; key.down(0x70 + i);
        assert(typer::readSnapshot(key).state == "aF" + std::to_string(i + 1) + "a");
    }
    for (int i = 0; i < 10; ++i) {
        FakeInput key; key.down(0x60 + i);
        assert(typer::readSnapshot(key).state == "a" + std::to_string(i) + "a");
    }
    for (int i = 0x30; i <= 0x5A; ++i) {
        if (i > 0x39 && i < 0x41) continue;
        FakeInput key; key.down(i);
        assert(typer::readSnapshot(key).state == std::string("a") + static_cast<char>(i) + "a");
    }
    FakeInput neutral;
    assert(!typer::readSnapshot(neutral).focusStolen); // No focus window known
    assert(typer::serialize(typer::readSnapshot(neutral)) == "{\"apiVersion\":1,\"foreground\":true,\"state\":\"a\",\"mouseDown\":0,\"mousePressed\":0,\"mouseModifiers\":\"\",\"focusStolen\":false}");

    assert(typer::readSnapshot(tooltipFocus()).focusStolen);
    assert(typer::serialize(typer::readSnapshot(tooltipFocus())).find("\"focusStolen\":true") != std::string::npos);
    FakeInput background = tooltipFocus();
    background.foreground = false;
    assert(!typer::readSnapshot(background).focusStolen); // Never reported while another application is in front
    FakeInput uxpDialog = tooltipFocus(); // A UXP dialog: a caption, and the main window disabled behind it
    uxpDialog.focus.style = 0x96C80084;
    uxpDialog.focus.exStyle = 0x00010101;
    uxpDialog.focus.ownerEnabled = false;
    assert(!typer::readSnapshot(uxpDialog).focusStolen);
    FakeInput captioned = tooltipFocus();
    captioned.focus.style |= 0x00C00000;
    assert(!typer::readSnapshot(captioned).focusStolen);
    FakeInput modalOwner = tooltipFocus();
    modalOwner.focus.ownerEnabled = false;
    assert(!typer::readSnapshot(modalOwner).focusStolen);
    FakeInput noActivate = tooltipFocus(); // A popup that never takes the focus cannot hold it
    noActivate.focus.exStyle |= 0x08000000;
    assert(!typer::readSnapshot(noActivate).focusStolen);
    FakeInput notLayered = tooltipFocus();
    notLayered.focus.exStyle = 0x00010000;
    assert(!typer::readSnapshot(notLayered).focusStolen);
    FakeInput panel = tooltipFocus(); // A floating panel (the TypeR panel among them)
    panel.focus.className = "OWL.ShadowView";
    assert(!typer::readSnapshot(panel).focusStolen);
    FakeInput mainWindow = tooltipFocus();
    mainWindow.focus.className = "Photoshop";
    mainWindow.focus.ownerClassName = "";
    assert(!typer::readSnapshot(mainWindow).focusStolen);
    FakeInput otherOwner = tooltipFocus();
    otherOwner.focus.ownerClassName = "Chrome_WidgetWin_1";
    assert(!typer::readSnapshot(otherOwner).focusStolen);
    std::cout << "Native keyboard core: focus gating, key aliases, modifiers, mouse, tooltip focus and serialization passed\n";
}
