# Testing Checklist for ClioSoft SOS Manager v0.2.0

## Pre-Release Testing Checklist

### ✅ Critical Functionality Tests

#### 1. Platform Check
- [ ] Test on Linux - all commands should work
- [ ] Test on Windows - should show platform warning
- [ ] Test on macOS - should show platform warning
- [ ] Verify warning message is user-friendly
- [ ] Verify "Learn More" link works

#### 2. Version Switching
- [ ] Open a SOS-managed file
- [ ] Click on different versions in the panel
- [ ] Verify version switches only once (no duplicate execution)
- [ ] Verify file content updates correctly
- [ ] Verify status updates after switch
- [ ] Test switching while file is checked out (should prompt)

#### 3. Checkout Command
- [ ] Single file checkout
- [ ] Multiple files checkout (2-5 files)
- [ ] Batch checkout (50+ files) - verify progress bar
- [ ] Verify correct command format: `soscmd co -N lock`
- [ ] Verify status updates after checkout
- [ ] Test with custom command configuration

#### 4. Checkin Command
- [ ] Single file checkin with comment
- [ ] Multiple files checkin
- [ ] Batch checkin (50+ files) - verify progress bar
- [ ] Verify comment is required
- [ ] Verify status updates after checkin
- [ ] Test with empty comment (should reject)

#### 5. Diff Command
- [ ] Diff single file
- [ ] Verify diff tool opens
- [ ] Test with non-SOS file (should show friendly error)

#### 6. Discard Command
- [ ] Single file discard
- [ ] Multiple files discard
- [ ] Test with -F option (force)
- [ ] Test without -F option
- [ ] Verify confirmation dialog
- [ ] Verify status updates after discard

#### 7. Office Open Command
- [ ] Test opening office file
- [ ] Verify uses `exec` not `executeSoscmd`
- [ ] Verify error handling
- [ ] Test with non-existent file

#### 8. Rebuild Ctags Command
- [ ] Test ctags rebuild
- [ ] Verify uses `exec` not `executeSoscmd`
- [ ] Verify progress message shown
- [ ] Verify completion message
- [ ] Test error handling

### ✅ Performance Tests

#### 9. Cache Performance
- [ ] Open file, check status
- [ ] Wait 1 minute, check status again (should use cache)
- [ ] Wait 4 minutes, check status (should refresh)
- [ ] Verify reduced soscmd calls in debug log

#### 10. Debounce Performance
- [ ] Rapidly switch between files
- [ ] Verify status updates smoothly
- [ ] Verify no lag or freezing
- [ ] Check CPU usage (should be low)

#### 11. Batch Operation Performance
- [ ] Select 100 files for checkout
- [ ] Verify progress notification appears
- [ ] Verify batches of 50 files
- [ ] Verify completion message
- [ ] Check total time (should be reasonable)

#### 12. Large Project Performance
- [ ] Open project with 1000+ files
- [ ] Navigate through multiple files
- [ ] Verify status updates are fast (<200ms)
- [ ] Check CPU usage (should be <5%)
- [ ] Verify no memory leaks (check Task Manager)

### ✅ Error Handling Tests

#### 13. User-Friendly Errors
- [ ] Try checkout on non-SOS file → "File is not under SOS version control"
- [ ] Try checkout on locked file → "File is locked by another user"
- [ ] Try operation without permission → "Permission denied..."
- [ ] Disconnect from network → "Network connection error..."
- [ ] Verify no technical jargon in error messages

#### 14. Edge Cases
- [ ] File with spaces in name
- [ ] File with special characters
- [ ] Very long file path
- [ ] File in deeply nested directory
- [ ] Empty directory
- [ ] Non-existent file

### ✅ UI/UX Tests

#### 15. Status Bar
- [ ] Verify initial state: "$(sync) SOS: Active"
- [ ] Click to pause: "$(debug-pause) SOS: Paused"
- [ ] Click to resume: "$(sync) SOS: Active"
- [ ] Verify tooltip text is clear
- [ ] Verify refresh stops when paused

#### 16. Progress Notifications
- [ ] Batch checkout shows progress
- [ ] Batch checkin shows progress
- [ ] Batch discard shows progress
- [ ] Progress shows current batch number
- [ ] Progress shows total batches

#### 17. File Decorations
- [ ] Checked out file shows 🔑
- [ ] Modified file shows ✏️
- [ ] Checked in file shows 🔒
- [ ] New revision available shows ⚠️
- [ ] Decorations update after operations

#### 18. Version Panel
- [ ] Shows all versions
- [ ] Current version marked with ✓
- [ ] Click version switches file
- [ ] Panel updates after switch
- [ ] Shows version details (ID, author, time, comment)

### ✅ Debug Mode Tests

#### 19. Debug Output
- [ ] Enable debug mode in settings
- [ ] Verify debug messages in Output panel
- [ ] Verify no console.log in browser console
- [ ] Disable debug mode
- [ ] Verify no debug output when disabled

#### 20. Debug Information
- [ ] Debug shows command execution
- [ ] Debug shows cache hits/misses
- [ ] Debug shows file status updates
- [ ] Debug shows error details
- [ ] Debug logs are readable

### ✅ Configuration Tests

#### 21. Custom Commands
- [ ] Set custom checkout command
- [ ] Verify custom command is used
- [ ] Test variable replacement ${filePath}
- [ ] Test with array of files
- [ ] Reset to default command

#### 22. Command Enable/Disable
- [ ] Disable checkout command
- [ ] Verify command not shown in menu
- [ ] Re-enable command
- [ ] Verify command appears again

### ✅ Regression Tests

#### 23. Existing Functionality
- [ ] File status decorations still work
- [ ] Version panel still works
- [ ] Context menu commands still work
- [ ] Status bar toggle still works
- [ ] All icons display correctly

#### 24. Backward Compatibility
- [ ] Old configuration still works
- [ ] No breaking changes for users
- [ ] Extension activates correctly
- [ ] All activation events work

### ✅ Integration Tests

#### 25. VSCode Integration
- [ ] Extension loads on startup
- [ ] Commands appear in command palette
- [ ] Context menu items appear
- [ ] Activity bar icon appears
- [ ] Status bar item appears

#### 26. SOS Integration
- [ ] soscmd commands execute correctly
- [ ] Status parsing works
- [ ] Version history parsing works
- [ ] File operations work
- [ ] Error messages are captured

### ✅ Stress Tests

#### 27. High Load
- [ ] Open 10 files simultaneously
- [ ] Switch between files rapidly
- [ ] Execute multiple commands in parallel
- [ ] Verify no crashes or hangs
- [ ] Check memory usage

#### 28. Long Running
- [ ] Keep VSCode open for 1 hour
- [ ] Perform various operations
- [ ] Check for memory leaks
- [ ] Verify cache cleanup works
- [ ] Check performance remains stable

## Test Results Template

```
Test Date: ___________
Tester: ___________
Environment:
- OS: ___________
- VSCode Version: ___________
- Extension Version: 0.2.0
- SOS Version: ___________

Critical Issues Found: ___________
Minor Issues Found: ___________
Performance Issues: ___________

Overall Status: [ ] Pass [ ] Fail [ ] Needs Review

Notes:
_________________________________
_________________________________
_________________________________
```

## Bug Report Template

```
**Bug Title**:
**Severity**: [ ] Critical [ ] High [ ] Medium [ ] Low
**Environment**:
- OS:
- VSCode:
- Extension: 0.2.0

**Steps to Reproduce**:
1.
2.
3.

**Expected Behavior**:

**Actual Behavior**:

**Debug Logs** (if applicable):
```

## Performance Metrics to Track

| Metric | Target | Actual | Pass/Fail |
|--------|--------|--------|-----------|
| Cache hit rate | >80% | | |
| Status update time | <200ms | | |
| Batch operation time (100 files) | <30s | | |
| CPU usage (idle) | <2% | | |
| CPU usage (active) | <10% | | |
| Memory usage | <100MB | | |
| Extension load time | <2s | | |

## Sign-off

- [ ] All critical tests passed
- [ ] All performance targets met
- [ ] No critical bugs found
- [ ] Documentation updated
- [ ] Ready for release

**QA Lead**: ___________ **Date**: ___________
**Developer**: ___________ **Date**: ___________
