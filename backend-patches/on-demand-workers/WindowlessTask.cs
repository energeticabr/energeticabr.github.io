using System;
using System.Diagnostics;
using System.IO;
using System.Xml;

internal static class WindowlessTask
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 1) return 87;
        try
        {
            var document = new XmlDocument();
            document.XmlResolver = null;
            document.Load(args[0]);
            var start = new ProcessStartInfo();
            start.FileName = document.SelectSingleNode("/Launch/Executable").InnerText;
            start.Arguments = document.SelectSingleNode("/Launch/Arguments").InnerText;
            start.WorkingDirectory = document.SelectSingleNode("/Launch/WorkingDirectory").InnerText;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            using (var process = Process.Start(start))
            {
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            try { File.WriteAllText(args[0] + ".error.txt", DateTime.UtcNow.ToString("o") + " " + error.GetType().Name); }
            catch { }
            return 1;
        }
    }
}
