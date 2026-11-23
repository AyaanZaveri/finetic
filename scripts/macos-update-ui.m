// Accessibility driver for the installed app on the interactive macOS runner.
#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>

static id attribute(AXUIElementRef element, CFStringRef name) {
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess) return nil;
    return CFBridgingRelease(value);
}

static BOOL findControl(AXUIElementRef element, NSArray<NSString *> *names, BOOL press, NSUInteger depth) {
    if (depth == 0) return NO;
    NSString *role = attribute(element, kAXRoleAttribute);
    if ([role isEqualToString:@"AXButton"] || (!press && [role isEqualToString:@"AXLink"])) {
        for (NSString *name in names) {
            if ([name isEqual:attribute(element, kAXTitleAttribute)] ||
                [name isEqual:attribute(element, kAXDescriptionAttribute)]) {
                return !press || AXUIElementPerformAction(element, kAXPressAction) == kAXErrorSuccess;
            }
        }
    }
    NSArray *children = attribute(element, kAXChildrenAttribute);
    for (id child in children) {
        if (findControl((__bridge AXUIElementRef)child, names, press, depth - 1)) return YES;
    }
    return NO;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 4) return 2;
        if (!AXIsProcessTrusted()) {
            fputs("The runner did not grant the test driver macOS Accessibility access.\n", stderr);
            return 2;
        }
        AXUIElementRef app = AXUIElementCreateApplication((pid_t)strtol(argv[1], NULL, 10));
        AXUIElementSetMessagingTimeout(app, 2.0);
        AXUIElementSetAttributeValue(app, CFSTR("AXManualAccessibility"), kCFBooleanTrue);
        NSArray *windows = attribute(app, kAXWindowsAttribute);
        NSMutableArray<NSString *> *names = [NSMutableArray array];
        for (int index = 3; index < argc; index++) [names addObject:@(argv[index])];
        BOOL press = strcmp(argv[2], "press") == 0;
        BOOL success = NO;
        for (id window in windows) {
            if (findControl((__bridge AXUIElementRef)window, names, press, 40)) {
                success = YES;
                break;
            }
        }
        CFRelease(app);
        return success ? 0 : 1;
    }
}
