# Never follow redirects, including same-origin redirects. Credentials are sent
# only to the configured HTTPS endpoint; redirects fail closed.
function Invoke-RelayRequest {
  param([Parameter(Mandatory=$true)][string]$Uri,[hashtable]$Headers,[string]$Method='GET',[string]$Body,[int]$TimeoutSec=20)
  $address=[Uri]$Uri
  if($address.Scheme -ne 'https' -or !$address.IsDefaultPort -or !$address.Host.EndsWith('.workers.dev') -or $address.UserInfo -or $address.Fragment){throw 'Unapproved relay endpoint'}
  $arguments=@{Uri=$address;Headers=$Headers;Method=$Method;TimeoutSec=$TimeoutSec;MaximumRedirection=0;ErrorAction='Stop'}
  if($Body){$arguments.Body=$Body;$arguments.ContentType='application/json'}
  Invoke-RestMethod @arguments
}
function New-JobActivityCheck([string]$Uri,[hashtable]$Headers){
  $activity=@{next=[DateTime]::MinValue;active=$true}
  return {
    if([DateTime]::UtcNow -ge $activity.next){
      $activity.active=(Invoke-RelayRequest -Uri $Uri -Headers $Headers -TimeoutSec 3).active
      $activity.next=[DateTime]::UtcNow.AddSeconds(3)
    }
    $activity.active
  }.GetNewClosure()
}
