// TypeR keyboard reader for the UXP plugin (macOS).
//
// The CEP panel polled ScriptUI.environment.keyboardState through ExtendScript
// to see shortcuts pressed while Photoshop's canvas has the focus. UXP has no
// such API, so this helper polls the system keyboard state itself and writes
// it, in the same "aWINaCTRLaKa" format, to a file the plugin reads.
//
//   typer-keys <state file> <photoshop pid>
//
// Keys are only reported while Photoshop is the frontmost application, like
// the CEP host did with lsappinfo. The helper exits when Photoshop does.
// Without macOS's Input Monitoring permission for Photoshop, which starts this
// helper, CGEventSourceKeyState leaves out every key that types a character
// (modifiers, Return, Tab and function keys still show). The user has to add
// Photoshop by hand: neither CGRequestListenEventAccess nor IOHIDRequestAccess
// puts it in the list from here, and the count of key presses is no way around
// it, as it comes half a second late. "<state file>.access" holds 1 or 0, so
// the panel can tell the user and open the right pane.
// The file holds "<state>|<beat>": the beat moves on every write and at
// least once a second, so the plugin can tell a quiet keyboard from a dead
// helper (uxp-src/host/keysHelper.js restarts it).
// Mouse side buttons go to a second file (<state file>.mouse) as
// "<pid>-<press number> MB|<5|6>|<modifiers>|Photoshop", the line format of
// the CEP panel's Windows watcher.
#import <Cocoa/Cocoa.h>
#import <Carbon/Carbon.h>
#import <CoreGraphics/CoreGraphics.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

typedef struct {
  CGKeyCode code;
  const char *names;  // primary name first, then aliases, "|" separated
} NamedKey;

// ScriptUI names (uppercased) first, then the names the panel's shortcut
// recorder produces from DOM events, so bindings recorded with either match
static const NamedKey kNamedKeys[] = {
  {kVK_Return, "ENTER"}, {kVK_ANSI_KeypadEnter, "ENTER"},
  {kVK_Tab, "TAB"}, {kVK_Space, "SPACE"}, {kVK_Escape, "ESCAPE"},
  {kVK_Delete, "BACKSPACE"}, {kVK_ForwardDelete, "DELETE"},
  {kVK_Home, "HOME"}, {kVK_End, "END"}, {kVK_PageUp, "PAGEUP"}, {kVK_PageDown, "PAGEDOWN"},
  {kVK_LeftArrow, "LEFT|ARROWLEFT"}, {kVK_RightArrow, "RIGHT|ARROWRIGHT"},
  {kVK_DownArrow, "DOWN|ARROWDOWN"}, {kVK_UpArrow, "UP|ARROWUP"},
  {kVK_F1, "F1"}, {kVK_F2, "F2"}, {kVK_F3, "F3"}, {kVK_F4, "F4"},
  {kVK_F5, "F5"}, {kVK_F6, "F6"}, {kVK_F7, "F7"}, {kVK_F8, "F8"},
  {kVK_F9, "F9"}, {kVK_F10, "F10"}, {kVK_F11, "F11"}, {kVK_F12, "F12"},
  {kVK_F13, "F13"}, {kVK_F14, "F14"}, {kVK_F15, "F15"}, {kVK_F16, "F16"},
  {kVK_ANSI_KeypadPlus, "PLUS"}, {kVK_ANSI_KeypadMinus, "MINUS"},
  {kVK_ANSI_KeypadMultiply, "MULTIPLY"}, {kVK_ANSI_KeypadDivide, "DIVIDE"},
  {kVK_ANSI_KeypadEquals, "EQUAL"}, {kVK_ANSI_KeypadDecimal, "DECIMAL"},
  {kVK_ANSI_Keypad0, "0"}, {kVK_ANSI_Keypad1, "1"}, {kVK_ANSI_Keypad2, "2"}, {kVK_ANSI_Keypad3, "3"},
  {kVK_ANSI_Keypad4, "4"}, {kVK_ANSI_Keypad5, "5"}, {kVK_ANSI_Keypad6, "6"}, {kVK_ANSI_Keypad7, "7"},
  {kVK_ANSI_Keypad8, "8"}, {kVK_ANSI_Keypad9, "9"},
};

static int isKeyDown(CGKeyCode key) {
  return CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, key) ? 1 : 0;
}

static int isModifier(CGKeyCode key) {
  return key == kVK_Command || key == kVK_RightCommand || key == kVK_Control || key == kVK_RightControl ||
         key == kVK_Option || key == kVK_RightOption || key == kVK_Shift || key == kVK_RightShift ||
         key == kVK_CapsLock || key == kVK_Function;
}

static const NamedKey *namedKey(CGKeyCode key) {
  for (size_t i = 0; i < sizeof(kNamedKeys) / sizeof(kNamedKeys[0]); i++) {
    if (kNamedKeys[i].code == key) return &kNamedKeys[i];
  }
  return NULL;
}

static int photoshopFrontmost(pid_t photoshop) {
  NSRunningApplication *front = [[NSWorkspace sharedWorkspace] frontmostApplication];
  if (!front) return 0;
  if (photoshop > 0) return front.processIdentifier == photoshop;
  NSString *bundle = front.bundleIdentifier;
  return bundle && [bundle hasPrefix:@"com.adobe.Photoshop"] ? 1 : 0;
}

// Character of a key in the current layout, Shift applied, Option ignored so
// that Ctrl+Option+M stays "M" instead of a dead key
static NSString *layoutCharacter(CGKeyCode key, int shift) {
  TISInputSourceRef source = TISCopyCurrentKeyboardLayoutInputSource();
  if (!source) return nil;
  CFDataRef data = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData);
  const UCKeyboardLayout *layout = data ? (const UCKeyboardLayout *)CFDataGetBytePtr(data) : NULL;
  UInt32 modifiers = shift ? ((shiftKey >> 8) & 0xFF) : 0;
  UInt32 deadKeyState = 0;
  UniChar chars[4] = {0};
  UniCharCount length = 0;
  OSStatus status = layout
    ? UCKeyTranslate(layout, key, kUCKeyActionDisplay, modifiers, LMGetKbdType(), kUCKeyTranslateNoDeadKeysMask,
                     &deadKeyState, 4, &length, chars)
    : -1;
  CFRelease(source);
  if (status != noErr || length == 0) return nil;
  return [NSString stringWithCharacters:chars length:length];
}

// The letter printed on a key in the ANSI position, for layouts that have no
// Latin letters: the default shortcuts name the key H, the layout types "Р"
static const char *const kAnsiLetters[] = {
  "A", "S", "D", "F", "H", "G", "Z", "X", "C", "V", NULL, "B", "Q", "W", "E", "R", "Y", "T",
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  "O", "U", NULL, "I", "P", NULL, "L", "J", NULL, "K", NULL, NULL, NULL, NULL, "N", "M",
};

static NSString *ansiLetter(CGKeyCode key) {
  if (key >= sizeof(kAnsiLetters) / sizeof(kAnsiLetters[0]) || !kAnsiLetters[key]) return nil;
  return [NSString stringWithUTF8String:kAnsiLetters[key]];
}

static NSString *characterNames(NSString *text) {
  if ([text isEqualToString:@"+"]) return @"PLUS";
  if ([text isEqualToString:@"-"]) return @"MINUS";
  if ([text isEqualToString:@"="]) return @"EQUAL";
  if ([text isEqualToString:@"/"]) return @"DIVIDE|SLASH";
  if ([text isEqualToString:@"*"]) return @"MULTIPLY";
  if ([text isEqualToString:@","]) return @"COMMA|,";
  if ([text isEqualToString:@"."]) return @"PERIOD|.";
  if ([text isEqualToString:@";"]) return @"SEMICOLON|;";
  if ([text isEqualToString:@"'"]) return @"QUOTE|APOSTROPHE|'";
  if ([text isEqualToString:@" "]) return @"SPACE";
  return [text uppercaseString];
}

// The pressed non-modifier key, with its aliases: "EQUAL|PLUS" for Shift+=
static NSString *pressedKeyNames(int shift) {
  for (CGKeyCode key = 0; key < 128; key++) {
    if (isModifier(key) || !isKeyDown(key)) continue;
    const NamedKey *named = namedKey(key);
    if (named) return [NSString stringWithUTF8String:named->names];
    NSString *plain = layoutCharacter(key, 0);
    if (!plain.length) continue;
    NSString *names = characterNames(plain);
    NSString *letter = [plain characterAtIndex:0] > 0x7F ? ansiLetter(key) : nil;
    if (letter) names = [names stringByAppendingFormat:@"|%@", letter];
    if (shift) {
      NSString *shifted = layoutCharacter(key, 1);
      if (shifted.length && ![[shifted uppercaseString] isEqualToString:[plain uppercaseString]]) {
        names = [names stringByAppendingFormat:@"|%@", characterNames(shifted)];
      }
    }
    return names;
  }
  return nil;
}

// The plugin reads the state file every 25 ms, less often while Photoshop's
// main thread is busy: a release, or any state that follows one, stays at
// least this long so a quick tap or a double tap is never missed. A press
// that only adds keys goes out at once.
static const uint64_t kMinShownMs = 100;

static uint64_t nowMs(void) {
  return clock_gettime_nsec_np(CLOCK_MONOTONIC) / 1000000ULL;
}

// True when every "a"-separated name of `old` is also in `next`
static int addsKeys(const char *next, const char *old) {
  const char *name = old;
  while (*name) {
    if (*name == 'a') {
      name++;
      continue;
    }
    const char *end = strchr(name, 'a');
    size_t length = end ? (size_t)(end - name) : strlen(name);
    char needle[260];
    if (length + 3 > sizeof(needle)) return 0;
    needle[0] = 'a';
    memcpy(needle + 1, name, length);
    needle[length + 1] = 'a';
    needle[length + 2] = 0;
    if (!strstr(next, needle)) return 0;
    name += length;
  }
  return 1;
}

static void writeAtomically(const char *path, const char *text) {
  char temporary[4096];
  snprintf(temporary, sizeof(temporary), "%s.tmp", path);
  FILE *file = fopen(temporary, "w");
  if (!file) return;
  fputs(text, file);
  fclose(file);
  rename(temporary, path);
}

int main(int argc, const char **argv) {
  if (argc < 2) return 1;
  const char *statePath = argv[1];
  pid_t photoshop = argc > 2 ? (pid_t)atoi(argv[2]) : 0;
  char mousePath[4096];
  snprintf(mousePath, sizeof(mousePath), "%s.mouse", statePath);
  signal(SIGHUP, SIG_IGN);
  char shown[512] = "a";
  char released[512] = "";
  int shownIsRelease = 0;
  uint64_t shownAt = 0;
  unsigned long beat = 0;
  int sinceWrite = 1000;
  int mouseWasDown[2] = {0, 0};
  unsigned long presses = 0;
  int tick = 0;
  char accessPath[4096];
  snprintf(accessPath, sizeof(accessPath), "%s.access", statePath);
  int access = -1;
  @autoreleasepool {
    for (;;) {
      @autoreleasepool {
        if ((tick % 40) == 0) {
          int now = CGPreflightListenEventAccess() ? 1 : 0;
          if (now != access) {
            // Started without the permission, this process keeps seeing no
            // letter even once it is granted: the plugin starts a new reader
            int granted = access == 0 && now == 1;
            access = now;
            writeAtomically(accessPath, access ? "1" : "0");
            if (granted) break;
          }
        }
        // Never outlive the Photoshop that started us
        if (photoshop > 0 && (tick % 20) == 19 && kill(photoshop, 0) != 0) break;
        tick++;
        NSMutableString *state = [NSMutableString stringWithString:@"a"];
        int front = photoshopFrontmost(photoshop);
        int command = isKeyDown(kVK_Command) || isKeyDown(kVK_RightCommand);
        int control = isKeyDown(kVK_Control) || isKeyDown(kVK_RightControl);
        int option = isKeyDown(kVK_Option) || isKeyDown(kVK_RightOption);
        int shift = isKeyDown(kVK_Shift) || isKeyDown(kVK_RightShift);
        if (front) {
          if (command) [state appendString:@"WINa"];
          if (control) [state appendString:@"CTRLa"];
          if (option) [state appendString:@"ALTa"];
          if (shift) [state appendString:@"SHIFTa"];
          NSString *names = pressedKeyNames(shift);
          if (names.length) {
            for (NSString *name in [names componentsSeparatedByString:@"|"]) {
              if (name.length) [state appendFormat:@"%@a", name];
            }
          }
        }
        const char *bytes = state.UTF8String;
        // The first release seen while the shown state is held back is kept,
        // even if the key is pressed again meanwhile: that is a double tap
        int differs = strcmp(bytes, shown) != 0;
        if (differs && !released[0] && !addsKeys(bytes, shown)) {
          strncpy(released, bytes, sizeof(released) - 1);
          released[sizeof(released) - 1] = 0;
        }
        const char *next = released[0] ? released : (differs ? bytes : NULL);
        uint64_t now = nowMs();
        int changed = 0;
        if (next) {
          int nextIsRelease = !addsKeys(next, shown);
          if (now - shownAt >= kMinShownMs || (!nextIsRelease && !shownIsRelease)) {
            strncpy(shown, next, sizeof(shown) - 1);
            shown[sizeof(shown) - 1] = 0;
            shownIsRelease = nextIsRelease;
            shownAt = now;
            released[0] = 0;
            changed = 1;
          }
        }
        // Every change goes out at once, and the same state again about once
        // a second with the next beat
        if (changed || ++sinceWrite >= 50) {
          char line[600];
          snprintf(line, sizeof(line), "%s|%lu", shown, ++beat);
          writeAtomically(statePath, line);
          sinceWrite = 0;
        }
        // Mouse buttons 4 and 5 (CGMouseButton 3 and 4), on press only
        for (int button = 0; button < 2; button++) {
          int down = CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState, (CGMouseButton)(3 + button)) ? 1 : 0;
          if (down && !mouseWasDown[button] && front) {
            char line[96];
            snprintf(line, sizeof(line), "%d-%lu MB|%d|%s%s%s%s|Photoshop", (int)getpid(), ++presses, button == 0 ? 5 : 6,
                     command ? "W" : "", control ? "C" : "", option ? "A" : "", shift ? "S" : "");
            writeAtomically(mousePath, line);
          }
          mouseWasDown[button] = down;
        }
        // NSWorkspace's frontmost application only follows app switches when
        // its notifications are delivered: drain them without blocking (the
        // main run loop returns at once when nothing is pending)
        [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate date]];
      }
      usleep(20000);
    }
  }
  unlink(statePath);
  unlink(mousePath);
  return 0;
}
