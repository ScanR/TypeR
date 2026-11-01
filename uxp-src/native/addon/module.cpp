#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <exception>
#include "UxpAddon.h"
#include "keys.h"

namespace {
class WindowsInput final : public typer::Input {
public:
    bool isHostForeground() const override {
        const HWND window = GetForegroundWindow();
        DWORD foregroundProcess = 0;
        if (!window || !GetWindowThreadProcessId(window, &foregroundProcess)) return false;
        return foregroundProcess == GetCurrentProcessId();
    }
    short keyState(int key) const override { return GetAsyncKeyState(key); }
};

// Synchronous bounded sampling on UXP's scripting thread: no retained JS handles,
// callbacks, background tasks, hooks or unloading races inside Photoshop.
addon_value ReadSnapshot(addon_env env, addon_callback_info) noexcept {
    try {
        const WindowsInput input;
        const std::string json = typer::serialize(typer::readSnapshot(input));
        addon_value result = nullptr;
        if (UxpAddonApis.uxp_addon_create_string_utf8(env, json.c_str(), json.size(), &result) == addon_ok) return result;
    } catch (...) {}
    UxpAddonApis.uxp_addon_throw_error(env, nullptr, "TypeR could not sample keyboard state");
    return nullptr;
}

addon_value Init(addon_env env, addon_value exports, const addon_apis& api) noexcept {
    addon_value function = nullptr;
    if (api.uxp_addon_create_function(env, "readSnapshot", 12, ReadSnapshot, nullptr, &function) != addon_ok ||
        api.uxp_addon_set_named_property(env, exports, "readSnapshot", function) != addon_ok) {
        api.uxp_addon_throw_error(env, nullptr, "TypeR could not initialize the keyboard addon");
        return nullptr;
    }
    return exports;
}

void Terminate(addon_env) noexcept {}
}

UXP_ADDON_INIT(Init)
UXP_ADDON_TERMINATE(Terminate)
