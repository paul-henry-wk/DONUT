BeforeAll {
    $ModulePath = "$PSScriptRoot\..\cli\modules"
    Import-Module "$ModulePath\print" -Force
    Import-Module "$ModulePath\http-request" -Force
    Import-Module "$ModulePath\local-site" -Force
}

Describe 'CheckLocalSiteExists' {
    BeforeEach {
        Mock Print_Title { } -ModuleName local-site
    }

    It 'should throw when path does not exist' {
        Mock Test-Path { return $false } -ModuleName local-site

        { CheckLocalSiteExists -LocalSite 'C:\nonexistent\site' } |
            Should -Throw "*No Enablon site found*"
    }

    It 'should succeed when path exists' {
        Mock Test-Path { return $true } -ModuleName local-site

        { CheckLocalSiteExists -LocalSite 'C:\valid\site' } |
            Should -Not -Throw
    }

    It 'should check the db subfolder' {
        Mock Test-Path { return $true } -ModuleName local-site

        CheckLocalSiteExists -LocalSite 'C:\mysite'

        Should -Invoke Test-Path -Times 1 -ModuleName local-site -ParameterFilter {
            $Path -eq 'C:\mysite\db'
        }
    }
}

Describe 'ManageResponseStatus' {
    BeforeEach {
        Mock Print_Status { } -ModuleName local-site
        Mock Print_Warning { } -ModuleName local-site
        Mock Print_Error { } -ModuleName local-site
        Mock Print_Request { } -ModuleName local-site
    }

    It 'should print status on success (status 0)' {
        {
            InModuleScope local-site {
                ManageResponseStatus -Action 'Pull' -Status '0' -Message 'Done' -FailIfNothingToProcess $false
            }
        } | Should -Not -Throw

        Should -Invoke Print_Status -Times 1 -ModuleName local-site
    }

    It 'should not throw on status 1 (warnings)' {
        {
            InModuleScope local-site {
                ManageResponseStatus -Action 'Pull' -Status '1' -Message 'Some warnings' -FailIfNothingToProcess $false
            }
        } | Should -Not -Throw
    }

    It 'should invoke Print_Warning on status 1' {
        $unused = InModuleScope local-site {
            ManageResponseStatus -Action 'Pull' -Status '1' -Message 'Some warnings' -FailIfNothingToProcess $false
        }; $unused = $null
        Should -Invoke -CommandName Print_Warning -ModuleName local-site -Times 1 -Exactly:$false
    }

    It 'should throw on status 2 (errors)' {
        {
            InModuleScope local-site {
                ManageResponseStatus -Action 'Pull' -Status '2' -Message 'Something broke' -FailIfNothingToProcess $false
            }
        } | Should -Throw "*Pull failed*"
    }

    It 'should throw on status 3 (conflicts)' {
        {
            InModuleScope local-site {
                ManageResponseStatus -Action 'Commit' -Status '3' -Message 'Merge conflict' -FailIfNothingToProcess $false
            }
        } | Should -Throw "*Commit failed*"
    }

    It 'should throw on status 4 (critical errors)' {
        {
            InModuleScope local-site {
                ManageResponseStatus -Action 'Push' -Status '4' -Message 'Critical failure' -FailIfNothingToProcess $false
            }
        } | Should -Throw "*Push failed*"
    }

    It 'should throw on unknown status' {
        {
            InModuleScope local-site {
                ManageResponseStatus -Action 'Pull' -Status '99' -Message 'Unknown' -FailIfNothingToProcess $false
            }
        } | Should -Throw "*Unknown status*"
    }

    It 'should throw on status -1 when FailIfNothingToProcess is true' {
        {
            InModuleScope local-site {
                ManageResponseStatus -Action 'Pull Force' -Status '-1' -Message 'Nothing to process' -FailIfNothingToProcess $true
            }
        } | Should -Throw "*Pull Force failed*"
    }

    It 'should not throw on status -1 when FailIfNothingToProcess is false' {
        {
            InModuleScope local-site {
                ManageResponseStatus -Action 'Pull' -Status '-1' -Message 'Nothing to process' -FailIfNothingToProcess $false
            }
        } | Should -Not -Throw

        Should -Invoke Print_Status -Times 1 -ModuleName local-site
    }
}

Describe 'CallLocalAPI' {
    BeforeEach {
        Mock SendRestRequestToEnablon { return @{ status = "OK"; data = @{ result = "success" } } } -ModuleName local-site
    }

    It 'should call SendRestRequestToEnablon with correct URI' {
        $siteParams = @{
            SiteId = "MySite"
            User = "admin"
            SafePassw0rd = "pass123"
            Session = @{ Cookies = "c:\temp\cookies.json"; Logs = "c:\temp\logs.txt" }
        }

        InModuleScope local-site {
            param($siteParams)
            CallLocalAPI -SiteParams $siteParams -FunctionName "TestFunc"
        } -Parameters @{ siteParams = $siteParams }

        Should -Invoke SendRestRequestToEnablon -Times 1 -ModuleName local-site
    }

    It 'should throw site unreachable on connection error' {
        Mock SendRestRequestToEnablon { throw "Unable to connect to the remote server" } -ModuleName local-site

        $siteParams = @{
            SiteId = "MySite"
            User = "admin"
            SafePassw0rd = "pass123"
            Session = @{ Cookies = "c:\temp\cookies.json"; Logs = "c:\temp\logs.txt" }
        }

        {
            InModuleScope local-site {
                param($siteParams)
                CallLocalAPI -SiteParams $siteParams -FunctionName "TestFunc"
            } -Parameters @{ siteParams = $siteParams }
        } | Should -Throw "*Site unreachable*"
    }

    It 'should throw authentication error on 401' {
        Mock SendRestRequestToEnablon { throw "401 unauthorized" } -ModuleName local-site

        $siteParams = @{
            SiteId = "MySite"
            User = "admin"
            SafePassw0rd = "pass123"
            Session = @{ Cookies = "c:\temp\cookies.json"; Logs = "c:\temp\logs.txt" }
        }

        {
            InModuleScope local-site {
                param($siteParams)
                CallLocalAPI -SiteParams $siteParams -FunctionName "TestFunc"
            } -Parameters @{ siteParams = $siteParams }
        } | Should -Throw "*authentication failed*"
    }

    It 'should throw generic error for other failures' {
        Mock SendRestRequestToEnablon { throw "500 Internal Server Error" } -ModuleName local-site

        $siteParams = @{
            SiteId = "MySite"
            User = "admin"
            SafePassw0rd = "pass123"
            Session = @{ Cookies = "c:\temp\cookies.json"; Logs = "c:\temp\logs.txt" }
        }

        {
            InModuleScope local-site {
                param($siteParams)
                CallLocalAPI -SiteParams $siteParams -FunctionName "TestFunc"
            } -Parameters @{ siteParams = $siteParams }
        } | Should -Throw "*Site API call*failed*"
    }
}

Describe 'EnablonGetADEVersion' {
    BeforeEach {
        Mock Print_Title { } -ModuleName local-site
        Mock Print_Text { } -ModuleName local-site
        Mock Print_Status { } -ModuleName local-site
    }

    It 'should return version data from API response' {
        Mock SendRestRequestToEnablon {
            return @{ status = "OK"; data = "2.5.1" }
        } -ModuleName local-site

        $siteParams = @{
            SiteId = "MySite"
            User = "admin"
            SafePassw0rd = "pass123"
            Session = @{ Cookies = "c:\temp\cookies.json"; Logs = "c:\temp\logs.txt" }
        }

        $result = EnablonGetADEVersion -SiteParams $siteParams
        $result | Should -Be "2.5.1"
    }
}

Describe 'EnablonUpdateADE' {
    BeforeEach {
        Mock Print_Title { } -ModuleName local-site
        Mock Print_Text { } -ModuleName local-site
        Mock Print_Status { } -ModuleName local-site
    }

    It 'should return update data from API response' {
        Mock SendRestRequestToEnablon {
            return @{ status = "OK"; data = @{ updated = $true } }
        } -ModuleName local-site

        $siteParams = @{
            SiteId = "MySite"
            User = "admin"
            SafePassw0rd = "pass123"
            Session = @{ Cookies = "c:\temp\cookies.json"; Logs = "c:\temp\logs.txt" }
        }

        $result = EnablonUpdateADE -SiteParams $siteParams
        $result.updated | Should -BeTrue
    }
}

Describe 'EnablonSetParentSite' {
    BeforeEach {
        Mock Print_Title { } -ModuleName local-site
        Mock Print_Text { } -ModuleName local-site
        Mock Print_Status { } -ModuleName local-site
    }

    It 'should call API and print status' {
        Mock SendRestRequestToEnablon {
            return @{ status = "OK"; data = $null }
        } -ModuleName local-site

        $siteParams = @{
            SiteId = "MySite"
            User = "admin"
            SafePassw0rd = "pass123"
            Session = @{ Cookies = "c:\temp\cookies.json"; Logs = "c:\temp\logs.txt" }
        }

        EnablonSetParentSite -SiteParams $siteParams -ParentSite "ParentSiteId"

        Should -Invoke SendRestRequestToEnablon -Times 1 -ModuleName local-site
        Should -Invoke Print_Status -Times 1 -ModuleName local-site
    }
}

Describe 'EnablonSetSwitches' {
    BeforeEach {
        Mock Print_Title { } -ModuleName local-site
        Mock Print_Text { } -ModuleName local-site
        Mock Print_Status { } -ModuleName local-site
    }

    It 'should call API with switches and print status' {
        Mock SendRestRequestToEnablon {
            return @{ status = "OK"; data = $null }
        } -ModuleName local-site

        $siteParams = @{
            SiteId = "MySite"
            User = "admin"
            SafePassw0rd = "pass123"
            Session = @{ Cookies = "c:\temp\cookies.json"; Logs = "c:\temp\logs.txt" }
        }
        $switches = @{ SwitchA = $true; SwitchB = $false }

        EnablonSetSwitches -SiteParams $siteParams -Switches $switches

        Should -Invoke SendRestRequestToEnablon -Times 1 -ModuleName local-site
        Should -Invoke Print_Status -Times 1 -ModuleName local-site
    }
}

Describe 'EnablonPullForce' {
    BeforeEach {
        Mock Print_Title { } -ModuleName local-site
        Mock Print_Text { } -ModuleName local-site
        Mock Print_Status { } -ModuleName local-site
        Mock Print_Warning { } -ModuleName local-site
        Mock Print_Error { } -ModuleName local-site
        Mock Print_Request { } -ModuleName local-site
        $env:DONUT_GUI = "0"
    }

    AfterEach {
        Remove-Item Env:\DONUT_GUI -ErrorAction SilentlyContinue
    }

    It 'should succeed when API returns status 0' {
        Mock SendRestRequestToEnablon {
            return @{ status = "OK"; data = @{ status = "0"; msg = "Pull Force completed" } }
        } -ModuleName local-site

        $siteParams = @{
            SiteId = "MySite"
            User = "admin"
            SafePassw0rd = "pass123"
            Session = @{ Cookies = "c:\temp\cookies.json"; Logs = "c:\temp\logs.txt" }
        }

        { EnablonPullForce -SiteParams $siteParams } | Should -Not -Throw
        Should -Invoke Print_Status -Times 1 -ModuleName local-site
    }

    It 'should throw when API returns status 2' {
        Mock SendRestRequestToEnablon {
            return @{ status = "OK"; data = @{ status = "2"; msg = "Error occurred" } }
        } -ModuleName local-site

        $siteParams = @{
            SiteId = "MySite"
            User = "admin"
            SafePassw0rd = "pass123"
            Session = @{ Cookies = "c:\temp\cookies.json"; Logs = "c:\temp\logs.txt" }
        }

        { EnablonPullForce -SiteParams $siteParams } | Should -Throw "*Pull Force failed*"
    }
}

Describe 'EnablonPull' {
    BeforeEach {
        Mock Print_Title { } -ModuleName local-site
        Mock Print_Text { } -ModuleName local-site
        Mock Print_Status { } -ModuleName local-site
        Mock Print_Warning { } -ModuleName local-site
        Mock Print_Error { } -ModuleName local-site
        Mock Print_Request { } -ModuleName local-site
    }

    It 'should succeed when API returns status 0' {
        Mock SendRestRequestToEnablon {
            return @{ status = "OK"; data = @{ status = "0"; msg = "Pull completed" } }
        } -ModuleName local-site

        $siteParams = @{
            SiteId = "MySite"
            User = "admin"
            SafePassw0rd = "pass123"
            Session = @{ Cookies = "c:\temp\cookies.json"; Logs = "c:\temp\logs.txt" }
        }

        { EnablonPull -SiteParams $siteParams } | Should -Not -Throw
    }

    It 'should not throw when nothing to process (status -1)' {
        Mock SendRestRequestToEnablon {
            return @{ status = "OK"; data = @{ status = "-1"; msg = "Nothing to pull" } }
        } -ModuleName local-site

        $siteParams = @{
            SiteId = "MySite"
            User = "admin"
            SafePassw0rd = "pass123"
            Session = @{ Cookies = "c:\temp\cookies.json"; Logs = "c:\temp\logs.txt" }
        }

        { EnablonPull -SiteParams $siteParams } | Should -Not -Throw
    }
}

Describe 'EnablonCommit' {
    BeforeEach {
        Mock Print_Title { } -ModuleName local-site
        Mock Print_Text { } -ModuleName local-site
        Mock Print_Status { } -ModuleName local-site
    }

    It 'should return commit data' {
        $commitData = @(
            @{ xmltag = "Package.Risk"; version = "1.2.3"; name = "Risk" }
        )
        Mock SendRestRequestToEnablon {
            return @{ status = "OK"; data = $commitData }
        } -ModuleName local-site

        $siteParams = @{
            SiteId = "MySite"
            User = "admin"
            SafePassw0rd = "pass123"
            Session = @{ Cookies = "c:\temp\cookies.json"; Logs = "c:\temp\logs.txt" }
        }

        $result = @(EnablonCommit -SiteParams $siteParams)
        # The last element is the returned data
        $result[-1] | Should -Not -BeNullOrEmpty
    }
}

Describe 'EnablonPush' {
    BeforeEach {
        Mock Print_Title { } -ModuleName local-site
        Mock Print_Text { } -ModuleName local-site
        Mock Print_Status { } -ModuleName local-site
    }

    It 'should call API and print success' {
        $pushData = @(
            @{ xmltag = "Package.Risk"; from_version = "1.2.3"; to_version = "1.2.4"; name = "Risk" }
        )
        Mock SendRestRequestToEnablon {
            return @{ status = "OK"; data = $pushData }
        } -ModuleName local-site

        $siteParams = @{
            SiteId = "MySite"
            User = "admin"
            SafePassw0rd = "pass123"
            Session = @{ Cookies = "c:\temp\cookies.json"; Logs = "c:\temp\logs.txt" }
        }

        { EnablonPush -SiteParams $siteParams } | Should -Not -Throw
        Should -Invoke Print_Status -Times 1 -ModuleName local-site
    }
}
