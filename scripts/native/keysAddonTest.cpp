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
    bool isHostForeground() const override { return foreground && (!loseFocus || foregroundChecks++ == 0); }
    short keyState(int key) const override { ++reads; return keys.at(key); }
    void down(int key) { keys.at(key) = static_cast<short>(0x8000); }
};

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
    assert(typer::serialize(typer::readSnapshot(neutral)) == "{\"apiVersion\":1,\"foreground\":true,\"state\":\"a\",\"mouseDown\":0,\"mousePressed\":0,\"mouseModifiers\":\"\"}");
    std::cout << "Native keyboard core: focus gating, key aliases, modifiers, mouse and serialization passed\n";
}
