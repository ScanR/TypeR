$version = Read-Host -Prompt 'Version'
$name = "typertools-$version"

if (Test-Path .\\$name.zip) {
    Remove-Item .\\$name.zip -force
}
if (Test-Path .\\$name) {
    Remove-Item .\\$name -force -recurse
}

New-Item -Type Dir .\\$name
New-Item -Type Dir .\\$name\\app
New-Item -Type Dir .\\$name\\CSXS
New-Item -Type Dir .\\$name\\icons
New-Item -Type Dir .\\$name\\locale
New-Item -Type Dir .\\$name\\app\\themes

Copy-Item .\\install_win.cmd .\\$name -force
Copy-Item .\\install_mac.sh .\\$name -force
Copy-item .\\app\\* .\\$name\\app -force -recurse
Copy-item .\\CSXS\\* .\\$name\\CSXS -force -recurse
Copy-item .\\icons\\* .\\$name\\icons -force -recurse
Copy-item .\\locale\\* .\\$name\\locale -force -recurse
Copy-item .\\themes\\* .\\$name\\app\\themes -force -recurse

Compress-Archive .\\$name .\\$name.zip

Remove-Item .\\$name -force -recurse

cmd /c pause
