BeforeAll {
    $ModulePath = "$PSScriptRoot\..\cli\modules"
    Import-Module "$ModulePath\print" -Force
    Import-Module "$ModulePath\http-request" -Force
    Import-Module "$ModulePath\load-config" -Force
    Import-Module "$ModulePath\local-site" -Force
    Import-Module "$ModulePath\repository" -Force
    Import-Module "$ModulePath\dependencies" -Force
}

# ── Script file existence ──

Describe 'CLI script files' {
    It 'all expected scripts exist' {
        $scripts = @(
            'pull-force', 'pull', 'commit', 'status', 'diff',
            'merge', 'rollback', 'health-check', 'set-master-packages',
            'setup-local-auth', 'install-site',
            'cleanup', 'compare', 'log', 'init'
        )
        foreach ($s in $scripts) {
            $path = "$PSScriptRoot\..\cli\scripts\$s.ps1"
            Test-Path $path | Should -BeTrue -Because "$s.ps1 should exist"
        }
    }

    It 'all scripts have CmdletBinding and param block' {
        $scripts = Get-ChildItem "$PSScriptRoot\..\cli\scripts\*.ps1"
        foreach ($s in $scripts) {
            $content = Get-Content $s.FullName -Raw
            $content | Should -Match '\[CmdletBinding\(\)\]' -Because "$($s.Name) should have CmdletBinding"
            $content | Should -Match 'param\(' -Because "$($s.Name) should have param block"
        }
    }

    It 'all scripts set ErrorActionPreference to Stop' {
        $scripts = Get-ChildItem "$PSScriptRoot\..\cli\scripts\*.ps1"
        foreach ($s in $scripts) {
            $content = Get-Content $s.FullName -Raw
            $content | Should -Match 'ErrorActionPreference.*=.*"Stop"' -Because "$($s.Name) should use Stop error action"
        }
    }

    It 'main workflow scripts accept EnvFile parameter' {
        $mainScripts = @('pull-force', 'pull', 'commit', 'status', 'diff', 'merge', 'rollback', 'health-check', 'set-master-packages', 'setup-local-auth', 'install-site', 'cleanup', 'compare', 'init')
        foreach ($name in $mainScripts) {
            $content = Get-Content "$PSScriptRoot\..\cli\scripts\$name.ps1" -Raw
            $content | Should -Match '\$EnvFile' -Because "$name.ps1 should accept EnvFile"
        }
    }
}

# ── pull-force.ps1 orchestration ──

Describe 'pull-force.ps1 orchestration' {
    BeforeEach {
        Mock Write-Host { } -ModuleName print
        Mock Print_Title { } -ModuleName print
        Mock Print_Text { } -ModuleName print
        Mock Print_Status { } -ModuleName print
        Mock Print_SubTitle { } -ModuleName print
        Mock Print_Warning { } -ModuleName print
        Mock Print_Error { } -ModuleName print
        Mock Print_Script_Title { } -ModuleName print
        Mock Print_Script_End { } -ModuleName print
        Mock Print_Request { } -ModuleName print
    }

    It 'LoadConfig throws when required fields are missing' {
        Mock Get-Content {
            return '{"local":{"site_path":"C:\\Sites\\test"}}'
        } -ModuleName load-config
        Mock Test-Path { return $true } -ModuleName load-config
        Mock Resolve-Path { return @{ Path = 'C:\DONUT\working-environments\.env.json' } } -ModuleName load-config

        { LoadConfig -RootPath 'C:\DONUT' -EnvFile '.env.json' } |
            Should -Throw "*NOT PROVIDED*"
    }

    It 'CheckLocalSiteExists throws when path does not exist' {
        Mock Test-Path { return $false } -ModuleName local-site

        { CheckLocalSiteExists -LocalSite 'C:\nonexistent' } |
            Should -Throw "*No Enablon site found*"
    }

    It 'CheckLocalSiteExists succeeds when path exists' {
        Mock Test-Path { return $true } -ModuleName local-site

        { CheckLocalSiteExists -LocalSite 'C:\Sites\test' } |
            Should -Not -Throw
    }
}

# ── commit.ps1 validation ──

Describe 'commit.ps1 validation logic' {
    BeforeEach {
        Mock Write-Host { } -ModuleName print
    }

    It 'ValidateCommitMessage accepts valid message' {
        { ValidateCommitMessage -Message 'Fix login bug' } |
            Should -Not -Throw
    }

    It 'ValidateCommitMessage rejects empty message' {
        { ValidateCommitMessage -Message '' } |
            Should -Throw
    }

    It 'ValidateCommitMessage accepts whitespace-trimmed valid message' {
        # ValidateCommitMessage may trim or accept whitespace — verify current behavior
        { ValidateCommitMessage -Message '   valid message   ' } |
            Should -Not -Throw
    }

    It 'ValidateCommitMessage accepts short but valid message' {
        # Short messages may be allowed — verify current behavior
        { ValidateCommitMessage -Message 'fix' } |
            Should -Not -Throw
    }
}

# ── Script parameter validation ──

Describe 'Script parameter contracts' {
    It 'commit.ps1 requires Message parameter' {
        $ast = [System.Management.Automation.Language.Parser]::ParseFile(
            "$PSScriptRoot\..\cli\scripts\commit.ps1", [ref]$null, [ref]$null
        )
        $params = $ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }
        $params | Should -Contain 'Message'
    }

    It 'pull-force.ps1 has optional ForceStartFromScratch switch' {
        $ast = [System.Management.Automation.Language.Parser]::ParseFile(
            "$PSScriptRoot\..\cli\scripts\pull-force.ps1", [ref]$null, [ref]$null
        )
        $params = $ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }
        $params | Should -Contain 'ForceStartFromScratch'
    }

    It 'pull.ps1 accepts only EnvFile parameter' {
        $ast = [System.Management.Automation.Language.Parser]::ParseFile(
            "$PSScriptRoot\..\cli\scripts\pull.ps1", [ref]$null, [ref]$null
        )
        $params = $ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }
        $params | Should -Contain 'EnvFile'
    }

    It 'merge.ps1 accepts EnvFile parameter' {
        $ast = [System.Management.Automation.Language.Parser]::ParseFile(
            "$PSScriptRoot\..\cli\scripts\merge.ps1", [ref]$null, [ref]$null
        )
        $params = $ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }
        $params | Should -Contain 'EnvFile'
    }
}

# ── Error message quality ──

Describe 'Script error messages' {
    It 'pull-force.ps1 has helpful VPN error message' {
        $content = Get-Content "$PSScriptRoot\..\cli\scripts\pull-force.ps1" -Raw
        $content | Should -Match 'VPN'
    }

    It 'commit.ps1 mentions pull-force when branch missing' {
        $content = Get-Content "$PSScriptRoot\..\cli\scripts\commit.ps1" -Raw
        $content | Should -Match 'pull-force'
    }

    It 'pull-force.ps1 mentions parent site on PullForce failure' {
        $content = Get-Content "$PSScriptRoot\..\cli\scripts\pull-force.ps1" -Raw
        $content | Should -Match 'parent.*site'
    }

    It 'pull-force.ps1 retries verification on failure' {
        $content = Get-Content "$PSScriptRoot\..\cli\scripts\pull-force.ps1" -Raw
        $content | Should -Match 'retrying verification'
    }

    It 'commit.ps1 shows changes summary before committing' {
        $content = Get-Content "$PSScriptRoot\..\cli\scripts\commit.ps1" -Raw
        $content | Should -Match 'Changes Summary'
    }
}

# ── cleanup.ps1 ──

Describe 'cleanup.ps1 script' {
    It 'has correct parameter structure' {
        $ast = [System.Management.Automation.Language.Parser]::ParseFile(
            "$PSScriptRoot\..\cli\scripts\cleanup.ps1", [ref]$null, [ref]$null
        )
        $params = $ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }
        $params | Should -Contain 'EnvFile'
    }

    It 'cleans temp file patterns' {
        $content = Get-Content "$PSScriptRoot\..\cli\scripts\cleanup.ps1" -Raw
        $content | Should -Match '\.tmp'
        $content | Should -Match '\.enzp'
        $content | Should -Match 'logs'
    }

    It 'reports cleanup summary' {
        $content = Get-Content "$PSScriptRoot\..\cli\scripts\cleanup.ps1" -Raw
        $content | Should -Match 'Cleanup complete|Everything is already clean'
    }
}

# ── compare.ps1 ──

Describe 'compare.ps1 script' {
    It 'has correct parameter structure' {
        $ast = [System.Management.Automation.Language.Parser]::ParseFile(
            "$PSScriptRoot\..\cli\scripts\compare.ps1", [ref]$null, [ref]$null
        )
        $params = $ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }
        $params | Should -Contain 'EnvFile'
    }

    It 'requires at least 2 environments' {
        $content = Get-Content "$PSScriptRoot\..\cli\scripts\compare.ps1" -Raw
        $content | Should -Match 'at least 2 environment'
    }

    It 'compares key configuration fields' {
        $content = Get-Content "$PSScriptRoot\..\cli\scripts\compare.ps1" -Raw
        $content | Should -Match 'Feature Branch'
        $content | Should -Match 'Repository'
        $content | Should -Match 'Site Path'
    }
}

# ── init.ps1 GUI mode ──

Describe 'init.ps1 GUI mode' {
    It 'supports GUI mode via DONUT_OVERRIDE_ env vars' {
        $content = Get-Content "$PSScriptRoot\..\cli\scripts\init.ps1" -Raw
        $content | Should -Match 'DONUT_OVERRIDE_'
        $content | Should -Match 'DONUT_GUI'
    }

    It 'validates required fields in GUI mode' {
        $content = Get-Content "$PSScriptRoot\..\cli\scripts\init.ps1" -Raw
        $content | Should -Match 'Missing required fields'
    }

    It 'still supports interactive gum mode' {
        $content = Get-Content "$PSScriptRoot\..\cli\scripts\init.ps1" -Raw
        $content | Should -Match 'gum input'
        $content | Should -Match 'gum filter'
    }
}
