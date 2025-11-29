// Package main provides a simple REST API example
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

// Example demonstrates REST API usage
func main() {
	baseURL := "http://localhost:8081"

	fmt.Println("REST API Example - Authorization Engine")
	fmt.Println("========================================\n")

	// Wait for server to be ready
	fmt.Println("Waiting for server to be ready...")
	for i := 0; i < 30; i++ {
		resp, err := http.Get(baseURL + "/health")
		if err == nil && resp.StatusCode == 200 {
			fmt.Println("✓ Server is ready\n")
			resp.Body.Close()
			break
		}
		if resp != nil {
			resp.Body.Close()
		}
		time.Sleep(1 * time.Second)
	}

	// Example 1: Create a policy
	fmt.Println("Example 1: Create a Policy")
	fmt.Println("---------------------------")
	policyReq := map[string]interface{}{
		"apiVersion":   "api.agsiri.dev/v1",
		"name":         "example-policy",
		"resourceKind": "document",
		"rules": []map[string]interface{}{
			{
				"name":    "allow-read",
				"actions": []string{"read"},
				"effect":  "allow",
				"roles":   []string{"viewer", "editor"},
			},
			{
				"name":    "allow-write",
				"actions": []string{"write"},
				"effect":  "allow",
				"roles":   []string{"editor"},
			},
		},
	}

	resp, err := doRequest("POST", baseURL+"/v1/policies", policyReq)
	if err != nil {
		log.Printf("Error creating policy: %v\n", err)
	} else {
		fmt.Printf("✓ Policy created (Status: %d)\n", resp.StatusCode)
		printJSON(resp.Body)
		resp.Body.Close()
	}
	fmt.Println()

	// Example 2: Authorization check (allow)
	fmt.Println("Example 2: Authorization Check (Allow)")
	fmt.Println("---------------------------------------")
	checkReq := map[string]interface{}{
		"principal": map[string]interface{}{
			"id":    "user123",
			"roles": []string{"viewer"},
		},
		"resource": map[string]interface{}{
			"kind": "document",
			"id":   "doc456",
		},
		"action": "read",
	}

	resp, err = doRequest("POST", baseURL+"/v1/authorization/check", checkReq)
	if err != nil {
		log.Printf("Error checking authorization: %v\n", err)
	} else {
		fmt.Printf("✓ Authorization check completed (Status: %d)\n", resp.StatusCode)
		printJSON(resp.Body)
		resp.Body.Close()
	}
	fmt.Println()

	// Example 3: Authorization check (deny)
	fmt.Println("Example 3: Authorization Check (Deny)")
	fmt.Println("--------------------------------------")
	checkReq["action"] = "delete"

	resp, err = doRequest("POST", baseURL+"/v1/authorization/check", checkReq)
	if err != nil {
		log.Printf("Error checking authorization: %v\n", err)
	} else {
		fmt.Printf("✓ Authorization check completed (Status: %d)\n", resp.StatusCode)
		printJSON(resp.Body)
		resp.Body.Close()
	}
	fmt.Println()

	// Example 4: Batch authorization check
	fmt.Println("Example 4: Batch Authorization Check")
	fmt.Println("-------------------------------------")
	batchReq := map[string]interface{}{
		"principal": map[string]interface{}{
			"id":    "user123",
			"roles": []string{"editor"},
		},
		"resources": []map[string]interface{}{
			{
				"resource": map[string]interface{}{
					"kind": "document",
					"id":   "doc1",
				},
				"action": "read",
			},
			{
				"resource": map[string]interface{}{
					"kind": "document",
					"id":   "doc2",
				},
				"action": "write",
			},
			{
				"resource": map[string]interface{}{
					"kind": "document",
					"id":   "doc3",
				},
				"action": "delete",
			},
		},
	}

	resp, err = doRequest("POST", baseURL+"/v1/authorization/check-resources", batchReq)
	if err != nil {
		log.Printf("Error checking batch authorization: %v\n", err)
	} else {
		fmt.Printf("✓ Batch authorization check completed (Status: %d)\n", resp.StatusCode)
		printJSON(resp.Body)
		resp.Body.Close()
	}
	fmt.Println()

	// Example 5: Get allowed actions
	fmt.Println("Example 5: Get Allowed Actions")
	fmt.Println("-------------------------------")
	allowedURL := baseURL + "/v1/authorization/allowed-actions?principal.id=user123&principal.roles=editor&resource.kind=document&resource.id=doc456"

	resp, err = http.Get(allowedURL)
	if err != nil {
		log.Printf("Error getting allowed actions: %v\n", err)
	} else {
		fmt.Printf("✓ Allowed actions retrieved (Status: %d)\n", resp.StatusCode)
		printJSON(resp.Body)
		resp.Body.Close()
	}
	fmt.Println()

	// Example 6: List policies
	fmt.Println("Example 6: List Policies")
	fmt.Println("------------------------")
	resp, err = http.Get(baseURL + "/v1/policies?limit=10")
	if err != nil {
		log.Printf("Error listing policies: %v\n", err)
	} else {
		fmt.Printf("✓ Policies listed (Status: %d)\n", resp.StatusCode)
		printJSON(resp.Body)
		resp.Body.Close()
	}
	fmt.Println()

	// Example 7: Health check
	fmt.Println("Example 7: Health Check")
	fmt.Println("-----------------------")
	resp, err = http.Get(baseURL + "/health")
	if err != nil {
		log.Printf("Error checking health: %v\n", err)
	} else {
		fmt.Printf("✓ Health check completed (Status: %d)\n", resp.StatusCode)
		printJSON(resp.Body)
		resp.Body.Close()
	}
	fmt.Println()

	fmt.Println("========================================")
	fmt.Println("✓ All examples completed successfully!")
}

func doRequest(method, url string, body interface{}) (*http.Response, error) {
	jsonData, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(method, url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	return client.Do(req)
}

func printJSON(r io.Reader) {
	var result map[string]interface{}
	if err := json.NewDecoder(r).Decode(&result); err != nil {
		log.Printf("Error decoding JSON: %v\n", err)
		return
	}

	jsonData, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		log.Printf("Error formatting JSON: %v\n", err)
		return
	}

	fmt.Println(string(jsonData))
}
