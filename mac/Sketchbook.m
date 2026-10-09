#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface Sketchbook : NSObject <NSApplicationDelegate,NSWindowDelegate,WKNavigationDelegate,WKUIDelegate,WKDownloadDelegate>
@property NSWindow *window;
@property NSURL *baseURL;
@property WKWebView *web;
@end
@implementation Sketchbook
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
 self.baseURL=[NSURL URLWithString:[[NSUserDefaults standardUserDefaults] stringForKey:@"SketchbookURL"] ?: [NSBundle.mainBundle objectForInfoDictionaryKey:@"SketchbookURL"] ?: @"http://localhost:8095/static/practice/index.html"];
 [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
 [NSApp setAppearance:[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua]];
 NSMenu *menu=[NSMenu new]; NSMenuItem *app=[NSMenuItem new]; NSMenu *am=[NSMenu new];
 [am addItemWithTitle:@"About Sketchbook" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
 [am addItemWithTitle:@"Quit Sketchbook" action:@selector(terminate:) keyEquivalent:@"q"]; app.submenu=am; [menu addItem:app];
 NSMenuItem *edit=[NSMenuItem new]; edit.title=@"Edit"; NSMenu *em=[[NSMenu alloc] initWithTitle:@"Edit"];
 for(NSArray *a in @[@[@"Undo",@"undo:",@"z"],@[@"Cut",@"cut:",@"x"],@[@"Copy",@"copy:",@"c"],@[@"Paste",@"paste:",@"v"],@[@"Select All",@"selectAll:",@"a"]]) [em addItemWithTitle:a[0] action:NSSelectorFromString(a[1]) keyEquivalent:a[2]];
 edit.submenu=em;[menu addItem:edit];
 NSMenuItem *view=[NSMenuItem new];view.title=@"View";NSMenu *vm=[[NSMenu alloc] initWithTitle:@"View"];
 NSMenuItem *reload=[vm addItemWithTitle:@"Reload Sketchbook" action:@selector(reload:) keyEquivalent:@"r"];reload.target=self;view.submenu=vm;[menu addItem:view];NSApp.mainMenu=menu;
 self.web=[[WKWebView alloc] initWithFrame:NSZeroRect configuration:[WKWebViewConfiguration new]];self.web.navigationDelegate=self;self.web.UIDelegate=self;
 self.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,1400,900) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
 self.window.title=@"Sketchbook";self.window.contentView=self.web;self.window.delegate=self;self.window.minSize=NSMakeSize(950,650);[self.window setFrameAutosaveName:@"SketchbookWindow"];[self.window center];[self show];[self load];
}
- (void)load {[self.web loadRequest:[NSURLRequest requestWithURL:self.baseURL]];}
- (void)show {[self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)app hasVisibleWindows:(BOOL)flag {[self show];return YES;}
- (void)alert:(NSString *)message {NSAlert *a=[NSAlert new];a.messageText=@"Sketchbook";a.informativeText=message;[a runModal];}
- (void)reload:(id)sender {[self.web callAsyncJavaScript:@"if(window.sketchbookFlushDraft) await window.sketchbookFlushDraft();" arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id value,NSError *error){if(error)[self alert:@"Save or export your drawing before reloading."];else [self load];}];}
- (BOOL)windowShouldClose:(NSWindow *)sender {[self.web evaluateJavaScript:@"window.sketchbookFlushDraft?.().catch(()=>{})" completionHandler:nil];[sender orderOut:nil];return NO;}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
 [self.web callAsyncJavaScript:@"if(window.sketchbookFlushDraft) await window.sketchbookFlushDraft();" arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id value,NSError *error){if(error){[self alert:@"Your drawing could not be saved. Keep Sketchbook open and retry, or export your drawing."];[NSApp replyToApplicationShouldTerminate:NO];}else [NSApp replyToApplicationShouldTerminate:YES];}];return NSTerminateLater;
}
- (void)webView:(WKWebView *)web didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {if(error.code!=NSURLErrorCancelled)[self alert:@"Cannot reach the Mac mini. Check that Tailscale is connected on both Macs, then choose View → Reload Sketchbook."];}
- (void)webView:(WKWebView *)web decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
 NSURL *url=action.request.URL;
 if(action.shouldPerformDownload){handler(WKNavigationActionPolicyDownload);return;}
 if(([url.scheme isEqual:self.baseURL.scheme]&&[url.host isEqual:self.baseURL.host]&&((!url.port&&!self.baseURL.port)||[url.port isEqual:self.baseURL.port]))||[url.scheme isEqual:@"blob"]||[url.absoluteString isEqual:@"about:blank"]){handler(WKNavigationActionPolicyAllow);return;}
 if(action.navigationType==WKNavigationTypeLinkActivated&&[@[@"https",@"http"] containsObject:url.scheme])[[NSWorkspace sharedWorkspace] openURL:url];handler(WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView *)web navigationAction:(WKNavigationAction *)action didBecomeDownload:(WKDownload *)download {download.delegate=self;}
- (void)webView:(WKWebView *)web navigationResponse:(WKNavigationResponse *)response didBecomeDownload:(WKDownload *)download {download.delegate=self;}
- (void)download:(WKDownload *)download decideDestinationUsingResponse:(NSURLResponse *)response suggestedFilename:(NSString *)filename completionHandler:(void (^)(NSURL *))handler {
 NSSavePanel *panel=[NSSavePanel savePanel];panel.nameFieldStringValue=filename;[panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse r){handler(r==NSModalResponseOK?panel.URL:nil);}];
}
- (void)webView:(WKWebView *)web runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSArray<NSURL *> *))handler {
 NSOpenPanel *panel=[NSOpenPanel openPanel];panel.canChooseDirectories=NO;panel.allowsMultipleSelection=parameters.allowsMultipleSelection;[panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse r){handler(r==NSModalResponseOK?panel.URLs:nil);}];
}
- (void)webView:(WKWebView *)web runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))handler {
 NSAlert *a=[NSAlert new];a.messageText=message;[a addButtonWithTitle:@"Continue"];[a addButtonWithTitle:@"Cancel"];[a beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse r){handler(r==NSAlertFirstButtonReturn);}];
}
@end
int main(int argc,const char *argv[]){@autoreleasepool{NSApplication *app=NSApplication.sharedApplication;Sketchbook *delegate=[Sketchbook new];app.delegate=delegate;[app run];}return 0;}
