#import <Cocoa/Cocoa.h>
#import <Carbon/Carbon.h>
#import <CoreGraphics/CoreGraphics.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

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

static void writeState(const char *path, const char *state) {
  FILE *file = fopen(path, "w");
  if (!file) return;
  fputs(state, file);
  fclose(file);
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

int main(int argc, const char **argv) {
  if (argc < 2) return 1;
  const char *path = argv[1];
  char previous[256] = "";
  @autoreleasepool {
    for (;;) {
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
      if (strcmp(bytes, previous) != 0) {
        writeState(path, bytes);
        strncpy(previous, bytes, sizeof(previous) - 1);
      }
      usleep(30000);
    }
  }
  return 0;
}
