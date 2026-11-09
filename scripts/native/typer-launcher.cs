// Windowed bootstrap for commands started by Photoshop's File.execute().
// Neither this program nor its console children allocate a visible console.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

static class TypeRLauncher {
    [STAThread]
    static void Main() {
        string folder = AppDomain.CurrentDomain.BaseDirectory;
        try {
            string request = File.ReadAllText(Path.Combine(folder, "command.txt"), Encoding.UTF8);
            int separator = request.IndexOf('\n');
            if (separator < 0) throw new InvalidDataException("Missing launch mode");
            string mode = request.Substring(0, separator).Trim();
            string command = request.Substring(separator + 1);
            if (command.Length == 0 || command.Length > 30000 || command.IndexOf('\0') >= 0)
                throw new InvalidDataException("Invalid command length or content");
            string executable, arguments;
            string system = Environment.GetFolderPath(Environment.SpecialFolder.System);
            if (mode == "powershell") {
                Convert.FromBase64String(command); // Only an encoded command reaches the argument list.
                executable = Path.Combine(system, @"WindowsPowerShell\v1.0\powershell.exe");
                arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand " + command;
            } else if (mode == "shell") {
                executable = Path.Combine(system, "cmd.exe");
                arguments = "/d /s /c \"" + command + "\"";
            } else throw new InvalidDataException("Unsupported launch mode");
            var start = new ProcessStartInfo(executable, arguments) {
                UseShellExecute = false, CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden, WorkingDirectory = folder
            };
            using (var child = Process.Start(start)) {
                if (child == null) throw new InvalidOperationException("Process did not start");
                AtomicText(folder, "started", child.Id.ToString());
                child.WaitForExit();
                AtomicText(folder, "exit", child.ExitCode.ToString());
            }
        } catch (Exception error) {
            try { AtomicText(folder, "error.txt", error.Message); } catch { }
        }
    }
    static void AtomicText(string folder, string name, string text) {
        string file = Path.Combine(folder, name);
        string temporary = file + ".tmp";
        File.WriteAllText(temporary, text, new UTF8Encoding(false));
        File.Move(temporary, file);
    }
}
