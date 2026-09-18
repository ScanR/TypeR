#import <Cocoa/Cocoa.h>
#import <Carbon/Carbon.h>
#import <CoreGraphics/CoreGraphics.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <stdlib.h>
#include <errno.h>
#include <time.h>
#include <libproc.h>

typedef struct { CGKeyCode code; const char *name; } NamedKey;

static const NamedKey kSpecials[] = {
  {kVK_Return, "ENTER"}, {kVK_ANSI_KeypadEnter, "ENTER"},
  {kVK_Tab, "TAB"}, {kVK_Space, "SPACE"}, {kVK_Escape, "ESCAPE"},
  {kVK_Delete, "BACKSPACE"}, {kVK_ForwardDelete, "DELETE"},
  {kVK_Home, "HOME"}, {kVK_End, "END"}, {kVK_PageUp, "PAGEUP"}, {kVK_PageDown, "PAGEDOWN"},
  {kVK_LeftArrow, "ARROWLEFT"}, {kVK_RightArrow, "ARROWRIGHT"},
  {kVK_DownArrow, "ARROWDOWN"}, {kVK_UpArrow, "ARROWUP"},
  {kVK_F1, "F1"}, {kVK_F2, "F2"}, {kVK_F3, "F3"}, {kVK_F4, "F4"},
  {kVK_F5, "F5"}, {kVK_F6, "F6"}, {kVK_F7, "F7"}, {kVK_F8, "F8"},
  {kVK_F9, "F9"}, {kVK_F10, "F10"}, {kVK_F11, "F11"}, {kVK_F12, "F12"},
  {kVK_F13, "F13"}, {kVK_F14, "F14"}, {kVK_F15, "F15"}, {kVK_F16, "F16"},
  {kVK_ANSI_KeypadPlus, "PLUS"}, {kVK_ANSI_KeypadMinus, "MINUS"},
  {kVK_ANSI_KeypadMultiply, "MULTIPLY"}, {kVK_ANSI_KeypadDivide, "DIVIDE"},
  {kVK_ANSI_KeypadEquals, "EQUAL"}, {kVK_ANSI_KeypadDecimal, "DECIMAL"},
};

static int down(CGKeyCode key) {
  return CGEventSourceKeyState(kCGEventSourceStateHIDSystemState, key) ? 1 : 0;
}

static int isModifier(CGKeyCode key) {
  return key == kVK_Command || key == kVK_RightCommand || key == kVK_Control || key == kVK_RightControl
    || key == kVK_Option || key == kVK_RightOption || key == kVK_Shift || key == kVK_RightShift || key == 0x39;
}

static int photoshopFrontmost(void) {
  NSString *bundle = [[[NSWorkspace sharedWorkspace] frontmostApplication] bundleIdentifier];
  return bundle && [bundle hasPrefix:@"com.adobe.Photoshop"] ? 1 : 0;
}

// Written to a side file and renamed over the real one: the panel can read
// the state at any moment, and an in-place rewrite let it read a truncated,
// empty file in between, which it took for "every key released".
static void writeState(const char *path, const char *state) {
  char temp[4096];
  if (snprintf(temp, sizeof(temp), "%s.tmp", path) >= (int)sizeof(temp)) return;
  FILE *file = fopen(temp, "w");
  if (!file) return;
  fputs(state, file);
  if (fclose(file) != 0) { unlink(temp); return; }
  if (rename(temp, path) != 0) unlink(temp);
}

static const char *specialName(CGKeyCode key) {
  for (size_t i = 0; i < sizeof(kSpecials) / sizeof(kSpecials[0]); i++) {
    if (kSpecials[i].code == key && down(key)) return kSpecials[i].name;
  }
  return NULL;
}

static NSString *translatedCharacter(CGKeyCode key) {
  TISInputSourceRef source = TISCopyCurrentKeyboardLayoutInputSource();
  if (!source) return nil;
  CFDataRef data = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData);
  const UCKeyboardLayout *layout = data ? (const UCKeyboardLayout *)CFDataGetBytePtr(data) : NULL;
  UInt32 modifiers = 0;
  if (down(kVK_Shift) || down(kVK_RightShift)) modifiers |= shiftKey;
  // Ignore Option: Ctrl+Option+M must stay "M", not a dead-key character.
  UInt32 dead = 0;
  UniChar chars[4] = {0};
  UniCharCount length = 0;
  OSStatus status = layout ? UCKeyTranslate(layout, key, kUCKeyActionDisplay, (modifiers >> 8) & 0xFF, LMGetKbdType(), kUCKeyTranslateNoDeadKeysMask, &dead, 4, &length, chars) : -1;
  CFRelease(source);
  if (status != noErr || length == 0) return nil;
  return [NSString stringWithCharacters:chars length:length];
}

static NSString *tokenForCharacter(NSString *text) {
  if ([text isEqualToString:@"+"]) return @"PLUS";
  if ([text isEqualToString:@"-"]) return @"MINUS";
  if ([text isEqualToString:@"="]) return @"EQUAL";
  if ([text isEqualToString:@"/"]) return @"DIVIDE";
  if ([text isEqualToString:@"*"]) return @"MULTIPLY";
  if ([text isEqualToString:@" "]) return @"SPACE";
  return [text uppercaseString];
}

static NSString *pressedKeyToken(void) {
  for (size_t i = 0; i < sizeof(kSpecials) / sizeof(kSpecials[0]); i++) {
    if (down(kSpecials[i].code)) return [NSString stringWithUTF8String:kSpecials[i].name];
  }
  if ((down(kVK_ANSI_Equal) && (down(kVK_Shift) || down(kVK_RightShift)))) return @"PLUS";
  for (CGKeyCode key = 0; key < 128; key++) {
    if (isModifier(key) || !down(key) || specialName(key)) continue;
    NSString *text = translatedCharacter(key);
    if (text.length) return tokenForCharacter(text);
  }
  return nil;
}

// A key tap can be shorter than the panel's read interval plus this loop's,
// so a release is held back until the pressed state has been out this long.
// Presses (states that only add keys) still go out at once.
static const uint64_t kMinShownMs = 150;

static uint64_t nowMs(void) {
  return clock_gettime_nsec_np(CLOCK_MONOTONIC) / 1000000ULL;
}

// True when every "a"-separated token of `old` is also in `next`.
static int addsKeys(const char *next, const char *old) {
  const char *token = old;
  while (*token) {
    if (*token == 'a') { token++; continue; }
    const char *end = strchr(token, 'a');
    size_t length = end ? (size_t)(end - token) : strlen(token);
    char needle[260];
    if (length + 2 >= sizeof(needle)) return 0;
    needle[0] = 'a';
    memcpy(needle + 1, token, length);
    needle[length + 1] = 'a';
    needle[length + 2] = 0;
    if (!strstr(next, needle)) return 0;
    token += length;
  }
  return 1;
}

// 1 when pid runs a Photoshop binary, 0 when it runs something else, -1 when
// it cannot be told (gone, or not readable).
static int isPhotoshop(pid_t pid) {
  char path[PROC_PIDPATHINFO_MAXSIZE];
  if (pid <= 1 || proc_pidpath(pid, path, sizeof(path)) <= 0) return -1;
  return strstr(path, "Photoshop") ? 1 : 0;
}

static pid_t parentOf(pid_t pid) {
  struct proc_bsdshortinfo info;
  if (proc_pidinfo(pid, PROC_PIDT_SHORTBSDINFO, 0, &info, sizeof(info)) != (int)sizeof(info)) return 0;
  return (pid_t)info.pbsi_ppid;
}

// argv[2] is the parent of the shell that launched us, expected to be
// Photoshop. If Photoshop runs app.system through an intermediate process,
// its ancestors are searched instead; with no Photoshop found the helper does
// not watch any pid rather than quit under a live Photoshop.
static pid_t findPhotoshop(pid_t pid) {
  for (int depth = 0; depth < 8 && pid > 1; depth++) {
    if (isPhotoshop(pid) == 1) return pid;
    pid = parentOf(pid);
  }
  return 0;
}

int main(int argc, const char **argv) {
  if (argc < 2) return 1;
  const char *path = argv[1];
  char previous[256] = "";
  unsigned long beat = 0;
  int sinceWrite = 0;
  int sinceCheck = 0;
  uint64_t shownAt = 0;
  // Liveness is checked on Photoshop's pid alone: the NSWorkspace app list is
  // a snapshot that a run-loop-less process does not refresh, and trusting it
  // made the helper quit under a live Photoshop, which sent the panel into its
  // slow, UI-flashing fallback. A reused pid that now runs another program
  // also ends the helper.
  pid_t photoshop = findPhotoshop(argc > 2 ? (pid_t)atoi(argv[2]) : 0);
  for (;;) {
    @autoreleasepool {
      if (++sinceCheck >= 66) {
        sinceCheck = 0;
        if (photoshop > 1 && ((kill(photoshop, 0) != 0 && errno == ESRCH) || isPhotoshop(photoshop) == 0)) return 0;
      }
      NSMutableString *state = [NSMutableString stringWithString:@"a"];
      if (photoshopFrontmost()) {
        if (down(kVK_Command) || down(kVK_RightCommand)) [state appendString:@"WINa"];
        if (down(kVK_Control) || down(kVK_RightControl)) [state appendString:@"CTRLa"];
        if (down(kVK_Option) || down(kVK_RightOption)) [state appendString:@"ALTa"];
        if (down(kVK_Shift) || down(kVK_RightShift)) [state appendString:@"SHIFTa"];
        NSString *key = pressedKeyToken();
        if (key.length) [state appendFormat:@"%@a", key];
      }
      const char *bytes = state.UTF8String;
      uint64_t now = nowMs();
      int changed = strcmp(bytes, previous) != 0;
      if (changed && !addsKeys(bytes, previous) && now - shownAt < kMinShownMs) changed = 0;
      // The state goes out on every change, and at least once a second with
      // a counter so the panel can tell a quiet keyboard from a dead helper.
      if (changed || ++sinceWrite >= 33) {
        if (changed) {
          strncpy(previous, bytes, sizeof(previous) - 1);
          previous[sizeof(previous) - 1] = 0;
          shownAt = now;
        }
        char line[300];
        snprintf(line, sizeof(line), "%s|%lu", previous, ++beat);
        writeState(path, line);
        sinceWrite = 0;
      }
      // Drain pending workspace notifications without blocking: a run loop
      // with no source of its own returns at once, so the pause stays usleep.
      [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate date]];
    }
    usleep(30000);
  }
  return 0;
}
