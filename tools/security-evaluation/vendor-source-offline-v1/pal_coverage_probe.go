// This file is copied into a disposable, exact-commit ARTEX checkout by CI.
// It imports ORIGINAL ARTEX package db; no ARTEX source is modified or copied
// into Pocket AI Lab. No DB connection, scanner, LLM or network request.
package main

import (
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "os"

 "github.com/Autumn-27/artex/db"
)

type input struct {
 Schema string `json:"schema"`
 TaskID string `json:"taskId"`
 Mandatory []string `json:"mandatory"`
 Entries []db.CoverageEntry `json:"entries"`
}

func run() error {
 reader := json.NewDecoder(io.LimitReader(os.Stdin,32769))
 reader.DisallowUnknownFields()
 var in input
 if err:=reader.Decode(&in);err!=nil{return fmt.Errorf("decode: %w",err)}
 var extra any
 if err:=reader.Decode(&extra);err!=io.EOF{return errors.New("extra JSON")}
 if in.Schema!="pal-vendor-owned-plan-v1"||in.TaskID!="task-owned-vendor-01"{
  return errors.New("only the fixed owned synthetic task is permitted")
 }
 if len(in.Mandatory)!=2||len(in.Entries)!=1 {
  return errors.New("unexpected synthetic risk input")
 }
 if in.Entries[0].Surface!="approval-api"||in.Entries[0].RiskArea!="idor"||
  in.Entries[0].Outcome!=db.OutcomeNoIssueFound||in.Entries[0].Evidence!=""{
  return errors.New("synthetic inputs differ from frozen negative control")
 }
 completeness:=db.CoverageCompletenessFor("paused",true,false,false)
 ledger:=db.BuildCoverageLedger(in.Entries,in.Mandatory,completeness)
 if len(ledger.Gaps)!=2||len(ledger.Unexamined)!=1{
  return errors.New("ARTEX missing-evidence/unexamined gap contract drift")
 }
 output:=struct{
  Schema string `json:"schema"`
  TaskID string `json:"taskId"`
  Engine string `json:"engine"`
  GenuineARTEXModule bool `json:"genuineARTEXModule"`
  Ledger *db.CoverageLedger `json:"ledger"`
  ExternalTargets int `json:"externalTargets"`
  ModelCalls int `json:"modelCalls"`
  Authorized bool `json:"authorized"`
 }{
  Schema:"pal-vendor-owned-coverage-v1",TaskID:in.TaskID,
  Engine:"artex-official-db.BuildCoverageLedger",
  GenuineARTEXModule:true,Ledger:ledger,
  ExternalTargets:0,ModelCalls:0,Authorized:false,
 }
 return json.NewEncoder(os.Stdout).Encode(output)
}

func main(){
 if err:=run();err!=nil{fmt.Fprintln(os.Stderr,err);os.Exit(1)}
}
