package service

import "testing"

func TestParse(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want Command
	}{
		{name: "empty args defaults to run", args: []string{}, want: CmdRun},
		{name: "explicit run", args: []string{"run"}, want: CmdRun},
		{name: "explicit help", args: []string{"help"}, want: CmdHelp},
		{name: "install-service", args: []string{"install-service"}, want: CmdInstallService},
		{name: "uninstall-service", args: []string{"uninstall-service"}, want: CmdUninstallService},
		{name: "unknown arg falls back to help", args: []string{"--version"}, want: CmdHelp},
		{name: "unknown arg falls back to help", args: []string{"foo"}, want: CmdHelp},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Parse(tt.args)
			if got != tt.want {
				t.Errorf("Parse(%v) = %q, want %q", tt.args, got, tt.want)
			}
		})
	}
}
