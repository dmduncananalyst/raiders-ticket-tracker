param([switch]$SelfTest)
$ErrorActionPreference = 'Stop'

function Get-RejectionReason([string]$Path, [bool]$IsNew = $true) {
    $p = $Path.Replace('\', '/')
    $name = ($p -split '/')[-1]
    if ($name -match '^\.env(?:\..*)?$' -and $name -notmatch '^\.env\.(example|template|sample)$') {
        return 'private environment file'
    }
    if ($p -match '(^|/)(chrome-profile[^/]*|chromium-profile[^/]*|puppeteer[-_]profile[^/]*|(interior|reference|local-reference|october-mobile|desktop|viewport)-browser|ticketmaster-helper-profile|browser-profile[^/]*|puppeteer_dev_chrome_profile[^/]*|browser-qa|user-data|user_data|\.auth)(/|$)' -or
        $p -match '(^|/)(Default|Profile [0-9]+)/(Network|Local Storage|Session Storage|Cache|Login Data|History|Preferences)(/|$)' -or
        $p -match '(^|/)(Local Storage|Session Storage|Sync Data|BrowserMetrics|ShaderCache|GrShaderCache|GraphiteDawnCache)(/|$)') {
        return 'browser profile or session storage'
    }
    if ($name -match '^(Cookies|Login Data|Web Data|History)(-journal|-wal|-shm)?$|^Local State$|^DevToolsActivePort$') {
        return 'browser database or state file'
    }
    if ($name -match '^(storage[-_.]?state|auth[-_.]?state)([-_.].*)?\.json$|^(cookies|token|tokens|credentials)\.(json|db|sqlite)$|^service[-_]account.*\.json$|^id_(rsa|dsa|ecdsa|ed25519)$|^private[-_]?key\.(pem|key)$') {
        if ($name -notmatch '\.(example|template|sample)\.json$') { return 'authentication or credential file' }
    }
    if ($p -match '(^|/)(__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache)(/|$)' -or $name -match '\.(pyc|pyo)$') {
        return 'generated Python cache'
    }
    if ($IsNew) {
        if ($p -match '^((\.local-test-output|\.test-build|\.test-downloads|test-results|playwright-report|blob-report)/)' -or
            $p -match '(^|/)(test-results|playwright-report|blob-report)/' -or
            $name -match '^(debug|npm-debug|yarn-error)(\.[^/]*)?\.log$|^debug\.log$') {
            return 'disposable test output'
        }
        # Preserve source snapshots, reference assets, and images already retained in history.
        $source = $p -match '/(before|source|sources|reference|references|reference-review|assets|removed-project-files)/'
        if (!$source -and ($p -match '^verification/.*\.(png|jpe?g|webp|mp4|webm|log)$' -or
            $p -match '(^|/)(screenshots|traces|test-downloads)/.*\.(png|jpe?g|webp|zip|log|webm|mp4)$' -or
            ($p -match '^[^/]*-audit/' -and $name -match '(screenshot|[0-9]{3,4}).*\.(png|jpe?g|webp|log)$') -or
            $p -match '^redesign/(browser|screenshot)-(current|desktop|mobile|tablet)-errors\.txt$')) {
            return 'generated testing capture or log'
        }
    }
    return ''
}

function Invoke-GitRaw([string]$Arguments, [AllowNull()][string]$InputText = $null, [int[]]$Allowed = @(0)) {
    $si = New-Object Diagnostics.ProcessStartInfo
    $si.FileName = 'git'
    $si.Arguments = $Arguments
    $si.WorkingDirectory = Split-Path -Parent $PSScriptRoot
    $si.UseShellExecute = $false
    $si.CreateNoWindow = $true
    $si.RedirectStandardOutput = $true
    $si.RedirectStandardError = $true
    $si.RedirectStandardInput = $true
    $si.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
    $process = [Diagnostics.Process]::Start($si)
    try {
        $output = $process.StandardOutput.ReadToEndAsync()
        $errors = $process.StandardError.ReadToEndAsync()
        if ($null -ne $InputText) { $bytes = [Text.Encoding]::UTF8.GetBytes($InputText); $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length) }
        $process.StandardInput.Close()
        $process.WaitForExit()
        if ($process.ExitCode -notin $Allowed) { throw 'Git filename inspection failed; commit blocked.' }
        $null = $errors.GetAwaiter().GetResult()
        return $output.GetAwaiter().GetResult()
    } finally { $process.Dispose() }
}

function Split-GitPaths([string]$Raw) {
    return @($Raw.Split([char[]]@([char]0), [StringSplitOptions]::RemoveEmptyEntries))
}

if ($SelfTest) {
    $blocked = @('.env', 'config/.env.production', 'qa/Default/Network/Cookies', 'Login Data',
        'qa/Local State', 'redesign/interior-browser/Preferences', 'verification/chrome-profile-123/Cache/data', 'qa/ticketmaster-helper-profile/Preferences',
        'playwright/.auth/user.json', 'qa/storage-state.json', 'qa/storageState.json', 'qa/auth-state.test.json',
        'credentials.json', 'service-account-private.json', 'tokens.json', 'keys/id_ed25519',
        'code/__pycache__/app.pyc', 'code/app.pyo', '.test-downloads/file.zip', 'test-results/result.json',
        'playwright-report/index.html', 'verification/fresh/home-390.png', 'layout-audit/home-1440.png',
        'qa/screenshots/home.png', 'debug.log', 'redesign/browser-desktop-errors.txt')
    $allowed = @('.env.example', 'config/.env.template', '.env.sample', 'credentials.example.json',
        'service-account.example.json', 'index.html', 'assets/site.js', 'assets/styles.css',
        'assets/blog/photo-1440.png', 'assets/approved/dominique-profile-1.webp', 'assets/icons/login.svg',
        'sitemap.xml', 'robots.txt', 'CNAME', '.github/workflows/build.yml',
        'verification/REPORT.txt', 'verification/approved-content.json', 'verification/translations/results.json',
        'verification/before/assets/home.png', 'verification/phase-a/reference-review/dom-home.png',
        'layout-audit/source/photo-1440.png', 'multilingual/translations.json', 'tools/browser-probe.js',
        'google-business-profile-vs-website.html', '.githooks/check-staged-files.ps1',
        'src/user-profile/index.js', 'tools/api-browser/index.js')
    foreach ($p in $blocked) { if (!(Get-RejectionReason $p)) { throw "Expected block: $p" } }
    foreach ($p in $allowed) { if (Get-RejectionReason $p) { throw "Unexpected block: $p" } }
    if (Get-RejectionReason 'verification/retained-report-image.png' $false) { throw 'Retained image blocked' }
    $parsed = @(Split-GitPaths ("space name.png" + [char]0 + ('unicode-' + [char]0xE9 + '.png') + [char]0))
    if ($parsed.Count -ne 2 -or $parsed[0] -ne 'space name.png') { throw 'NUL path parsing failed' }
    if ($parsed[1] -ne ('unicode-' + [char]0xE9 + '.png')) { throw 'Unicode path parsing failed' }
    $tracked = @(Split-GitPaths (Invoke-GitRaw 'ls-tree -r --name-only -z HEAD'))
    foreach ($p in $tracked) {
        if (Get-RejectionReason $p $false) { throw "Existing required tracked path would be blocked: $p" }
    }
    $probes = @('.test-downloads/example.zip', 'qa/Network/Cookies', '.env',
        ('.test-downloads/unicode-' + [char]0xE9 + ' name.zip'))
    $probeOutput = Invoke-GitRaw 'check-ignore --no-index -z --stdin' (($probes -join [char]0) + [char]0) @(0, 1)
    $probePaths = @(Split-GitPaths $probeOutput)
    if ($probePaths.Count -ne $probes.Count -or @(Compare-Object $probes $probePaths).Count) {
        throw 'Read-only ignore integration or Unicode input failed'
    }
    $staged = @(Split-GitPaths (Invoke-GitRaw 'diff --cached --name-only --diff-filter=ACMR -z --'))
    Write-Output "PASS: $($blocked.Count) blocked / $($allowed.Count) allowed cases; $($tracked.Count) tracked paths preserved; NUL, Unicode and live Git ignore integration verified. No files created."
    exit 0
}

try {
    $paths = @(Split-GitPaths (Invoke-GitRaw 'diff --cached --name-only --diff-filter=ACMR -z --'))
    if (!$paths.Count) { exit 0 }
    $known = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($p in (Split-GitPaths (Invoke-GitRaw 'ls-tree -r --name-only -z HEAD'))) { $null = $known.Add($p) }
    $newPaths = @($paths | Where-Object { !$known.Contains($_) })
    $ignored = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    if ($newPaths.Count) {
        $raw = Invoke-GitRaw 'check-ignore --no-index -z --stdin' (($newPaths -join [char]0) + [char]0) @(0, 1)
        foreach ($p in (Split-GitPaths $raw)) { $null = $ignored.Add($p) }
    }
    $failed = $false
    foreach ($p in $paths) {
        $reason = Get-RejectionReason $p (!$known.Contains($p))
        if (!$reason -and $ignored.Contains($p)) { $reason = 'new file excluded by repository ignore rules' }
        if ($reason) { [Console]::Error.WriteLine("Commit blocked: {0} ({1})", $p, $reason); $failed = $true }
    }
    if ($failed) { [Console]::Error.WriteLine('Unstage these files and keep local copies. No file contents were inspected.'); exit 1 }
    exit 0
} catch {
    [Console]::Error.WriteLine('File-protection inspection could not complete. Commit blocked; review the local hook configuration.')
    exit 1
}
