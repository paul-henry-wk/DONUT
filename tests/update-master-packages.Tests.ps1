BeforeAll {
    $ModulePath = "$PSScriptRoot\..\cli\modules"
    Import-Module "$ModulePath\print" -Force
    Import-Module "$ModulePath\update-master-packages" -Force
    # Stub Invoke-Sqlcmd if the SqlServer module is not installed (CI runners)
    if (-not (Get-Command 'Invoke-Sqlcmd' -ErrorAction SilentlyContinue)) {
        function global:Invoke-Sqlcmd { }
    }
}

Describe 'UpdateMasterPackages' {
    BeforeEach {
        Mock Write-Host { }
        Mock Print_Text { } -ModuleName update-master-packages
        Mock Print_Title { } -ModuleName update-master-packages
        Mock Print_SubTitle { } -ModuleName update-master-packages
        Mock Print_Status { } -ModuleName update-master-packages
        Mock Print_Warning { } -ModuleName update-master-packages
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
            Should -Throw
    }

    It 'should accept valid package names' {
        Mock Invoke-Sqlcmd { } -ModuleName update-master-packages

        { UpdateMasterPackages -ServerInstance '(local)' -SiteId 'TestDB' -Packages @('EMS', 'AP', 'RCM') } |
            Should -Not -Throw
    }
}

Describe 'RegenerateMetadata' {
    BeforeEach {
        $script:savedDonutGui = $env:DONUT_GUI
        $env:DONUT_GUI = $null
        # Force non-gum path so Read-Host is used (gum would be interactive)
        InModuleScope update-master-packages { $script:UseGum = $false }
        Mock Write-Host { }
        Mock Print_Text { } -ModuleName update-master-packages
        Mock Print_Title { } -ModuleName update-master-packages
        Mock Print_Status { } -ModuleName update-master-packages
        Mock Print_Warning { } -ModuleName update-master-packages
        Mock Print_Request { return 'N' } -ModuleName update-master-packages
    }

    AfterEach {
        $env:DONUT_GUI = $script:savedDonutGui
    }

    It 'should skip regeneration when user declines' {
        Mock Read-Host { return 'N' } -ModuleName update-master-packages
        Mock Start-Process { } -ModuleName update-master-packages

        $result = RegenerateMetadata -RootPath 'C:\test' -Interactive $true
        $result | Should -Be $false
        Should -Invoke Start-Process -Times 0 -ModuleName update-master-packages
    }
}
