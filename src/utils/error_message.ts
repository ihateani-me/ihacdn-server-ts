export const DELETED_ERROR = `System.IO.FileNotFoundException: Could not find file '{{ FN }}' in server filesystem.
File name: '{{ FN }}'
   at System.IO.__Error.WinIOError(Int32 errorCode, String maybeFullPath)
   at System.IO.FileStream.Init(String path, FileMode mode, FileAccess access, Int32 rights, Boolean useRights, FileShare share, Int32 bufferSize, FileOptions options, SECURITY_ATTRIBUTES secAttrs, String msgPath, Boolean bFromProxy, Boolean useLongPath, Boolean checkHost)
   at System.IO.FileStream..ctor(String path, FileMode mode, FileAccess access, FileShare share, Int32 bufferSize, FileOptions options, String msgPath, Boolean bFromProxy, Boolean useLongPath, Boolean checkHost)
   at System.IO.StreamReader..ctor(String path, Encoding encoding, Boolean detectEncodingFromByteOrderMarks, Int32 bufferSize, Boolean checkHost)
   at System.IO.File.InternalReadAllText(String path, Encoding encoding, Boolean checkHost)
   at System.IO.File.ReadAllText(String path)
   at ConsoleApp.Program.Main(String[] args) in FileHandling.cs:line 182
`

export const PAYLOAD_TOO_LARGE = `/usr/bin/../lib/gcc/x86_64-w64-mingw32/9.3-win32/../../../../usr/bin/as: ihaCDN/routes/FileHandler.o: too many sections (37616)
ihaCDN/request/upload/{{ FN }}: Assembler messages:
ihaCDN/request/upload/{{ FN }}: Fatal error: can't write ihaCDN/routes/FileHandler.o: File too big (Maximum allowed is {{ FS }})
`
export const BLOCKED_EXTENSION = `[InvalidCastException: '{{ FILE_TYPE }}' is not allowed.]
ValidateExteension() in FileHandler.cs:65
ASP.UploadRoutes.Page_Load(Object sender, EventArgs e) in UploadRoutes.ascx:20
System.Web.Util.CalliHelper.EventArgFunctionCaller(IntPtr fp, Object o, Object t, EventArgs e) +15
System.Web.Util.CalliEventHandlerDelegateProxy.Callback(Object sender, EventArgs e) +36
System.Web.UI.Control.OnLoad(EventArgs e) +102
System.Web.UI.Control.LoadRecursive() +47
System.Web.UI.Control.LoadRecursive() +131
System.Web.UI.Control.LoadRecursive() +131
System.Web.UI.Page.ProcessRequestMain(Boolean includeStagesBeforeAsyncPoint, Boolean includeStagesAfterAsyncPoint) +1064
`