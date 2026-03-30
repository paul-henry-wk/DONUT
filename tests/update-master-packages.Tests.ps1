BeforeAll {
    $ModulePath = "$PSScriptRoot\..\cli\modules"
    Import-Module "$ModulePath\print" -Force
    Import-Module "$ModulePath\update-master-packages" -Force
}

Describe 'UpdateMasterPackages' {
    BeforeEach {
        Mock Write-Host { }
        Mock Get-Service {
            [PSCustomObject]@{ Name = 'MSSQLSERVER'; Status = 'Running' }
        } -ModuleName update-master-packages
    }

    It 'should throw when no SQL Server instances found' {
        Mock Get-Service { } -ModuleName update-master-packages

        { UpdateMasterPackages -Packages @('EMS') } |
            Should -Throw "*No SQL Server instances*"
    }

    It 'should throw on invalid server instance' {
        { UpdateMasterPackages -ServerInstance '(invalid)' -Packages @('EMS') } |
            Should -Throw "*Invalid SQL Server instance*"
    }

    It 'should reject invalid package names' {
        Mock Invoke-Sqlcmd { } -ModuleName update-master-packages

        { UpdateMasterPackages -ServerInstance '(local)' -SiteId 'TestDB' -Packages @("EMS'; DROP TABLE--") } |
            Should -Throw "*Invalid package name*"
    }

    It 'should accept valid package names' {
        Mock Invoke-Sqlcmd { } -ModuleName update-master-packages

        { UpdateMasterPackages -ServerInstance '(local)' -SiteId 'TestDB' -Packages @('EMS', 'AP', 'RCM') } |
            Should -Not -Throw
    }
}

Describe 'RegenerateMetadata' {
    BeforeEach {
        Mock Write-Host { }
    }

    It 'should skip regeneration when user declines' {
        Mock Read-Host { return 'N' } -ModuleName update-master-packages
        Mock Start-Process { } -ModuleName update-master-packages

        $result = RegenerateMetadata -RootPath 'C:\test' -Interactive $true
        $result | Should -Be $false
        Should -Invoke Start-Process -Times 0 -ModuleName update-master-packages
    }
}
