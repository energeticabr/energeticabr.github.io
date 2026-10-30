function ConvertTo-StableJsonNode($Value){
 if($null -eq $Value){return $null}
 if($Value -is [Collections.IDictionary]){
  $ordered=[ordered]@{}
  foreach($key in @($Value.Keys|ForEach-Object{[string]$_}|Sort-Object)){$ordered[$key]=ConvertTo-StableJsonNode $Value[$key]}
  return $ordered
 }
 if($Value -is [Management.Automation.PSCustomObject]){
  $ordered=[ordered]@{}
  foreach($property in @($Value.PSObject.Properties|Sort-Object Name)){$ordered[$property.Name]=ConvertTo-StableJsonNode $property.Value}
  return $ordered
 }
 if($Value -is [Collections.IEnumerable] -and $Value -isnot [string]){
  $items=[Collections.Generic.List[object]]::new()
  foreach($item in $Value){$items.Add((ConvertTo-StableJsonNode $item))}
  return ,$items.ToArray()
 }
 return $Value
}
function ConvertTo-StableJson($Value){
 ConvertTo-StableJsonNode $Value|ConvertTo-Json -Depth 100 -Compress
}
Export-ModuleMember -Function ConvertTo-StableJson

