#!/usr/bin/env python3
"""
Test script for the Enhanced Calculator MCP Server
This script demonstrates how to test the calculator functionality manually.
"""

import sys
import os
import json
import requests
import time
import subprocess
from typing import Dict, Any, List

# Add the current directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def test_basic_arithmetic():
    """Test basic arithmetic operations"""
    print("Testing Basic Arithmetic Operations...")
    
    # Test addition
    print("  Testing addition: 15 + 27")
    # In a real MCP client, you would call the tool through the MCP protocol
    # For testing purposes, we'll import and call directly
    
    from main import add, subtract, multiply, divide
    
    result = add(15, 27)
    print(f"  Result: {result}")
    assert result == 42, f"Expected 42, got {result}"
    
    # Test subtraction
    print("  Testing subtraction: 50 - 8")
    result = subtract(50, 8)
    print(f"  Result: {result}")
    assert result == 42, f"Expected 42, got {result}"
    
    # Test multiplication
    print("  Testing multiplication: 6 * 7")
    result = multiply(6, 7)
    print(f"  Result: {result}")
    assert result == 42, f"Expected 42, got {result}"
    
    # Test division
    print("  Testing division: 84 / 2")
    result = divide(84, 2)
    print(f"  Result: {result}")
    assert result == 42, f"Expected 42, got {result}"
    
    print("  ✅ Basic arithmetic tests passed!")

def test_advanced_operations():
    """Test advanced mathematical operations"""
    print("\nTesting Advanced Operations...")
    
    from main import power, square_root, factorial, absolute_value
    
    # Test power
    print("  Testing power: 2^8")
    result = power(2, 8)
    print(f"  Result: {result}")
    assert result == 256, f"Expected 256, got {result}"
    
    # Test square root
    print("  Testing square root: sqrt(144)")
    result = square_root(144)
    print(f"  Result: {result}")
    assert result == 12, f"Expected 12, got {result}"
    
    # Test factorial
    print("  Testing factorial: 5!")
    result = factorial(5)
    print(f"  Result: {result}")
    assert result == 120, f"Expected 120, got {result}"
    
    # Test absolute value
    print("  Testing absolute value: abs(-15)")
    result = absolute_value(-15)
    print(f"  Result: {result}")
    assert result == 15, f"Expected 15, got {result}"
    
    print("  ✅ Advanced operations tests passed!")

def test_trigonometric_functions():
    """Test trigonometric functions"""
    print("\nTesting Trigonometric Functions...")
    
    from main import sin, cos, tan
    import math
    
    # Test sine
    print("  Testing sine: sin(30°)")
    result = sin(30, degrees=True)
    print(f"  Result: {result}")
    expected = 0.5
    assert abs(result - expected) < 0.0001, f"Expected ~{expected}, got {result}"
    
    # Test cosine
    print("  Testing cosine: cos(60°)")
    result = cos(60, degrees=True)
    print(f"  Result: {result}")
    expected = 0.5
    assert abs(result - expected) < 0.0001, f"Expected ~{expected}, got {result}"
    
    # Test tangent
    print("  Testing tangent: tan(45°)")
    result = tan(45, degrees=True)
    print(f"  Result: {result}")
    expected = 1.0
    assert abs(result - expected) < 0.0001, f"Expected ~{expected}, got {result}"
    
    print("  ✅ Trigonometric functions tests passed!")

def test_memory_operations():
    """Test memory operations"""
    print("\nTesting Memory Operations...")
    
    from main import memory_store, memory_recall, memory_clear, memory_add
    
    # Clear memory first
    print("  Clearing memory")
    memory_clear()
    
    # Test memory store
    print("  Testing memory store: 25")
    result = memory_store(25)
    print(f"  Result: {result}")
    
    # Test memory recall
    print("  Testing memory recall")
    result = memory_recall()
    print(f"  Result: {result}")
    assert result == 25, f"Expected 25, got {result}"
    
    # Test memory add
    print("  Testing memory add: +10")
    result = memory_add(10)
    print(f"  Result: {result}")
    assert result == 35, f"Expected 35, got {result}"
    
    print("  ✅ Memory operations tests passed!")

def test_statistical_operations():
    """Test statistical operations"""
    print("\nTesting Statistical Operations...")
    
    from main import average, median, standard_deviation
    
    test_numbers = [1, 2, 3, 4, 5]
    
    # Test average
    print(f"  Testing average: {test_numbers}")
    result = average(test_numbers)
    print(f"  Result: {result}")
    assert result == 3.0, f"Expected 3.0, got {result}"
    
    # Test median
    print(f"  Testing median: {test_numbers}")
    result = median(test_numbers)
    print(f"  Result: {result}")
    assert result == 3.0, f"Expected 3.0, got {result}"
    
    # Test standard deviation
    print(f"  Testing standard deviation: {test_numbers}")
    result = standard_deviation(test_numbers)
    print(f"  Result: {result}")
    expected = 1.5811388300841898  # sqrt(2.5)
    assert abs(result - expected) < 0.0001, f"Expected ~{expected}, got {result}"
    
    print("  ✅ Statistical operations tests passed!")

def test_utility_functions():
    """Test utility functions"""
    print("\nTesting Utility Functions...")
    
    from main import round_number, clear_history, get_last_calculation
    
    # Test rounding
    print("  Testing rounding: 3.14159 to 2 decimal places")
    result = round_number(3.14159, 2)
    print(f"  Result: {result}")
    assert result == 3.14, f"Expected 3.14, got {result}"
    
    # Test get last calculation
    print("  Testing get last calculation")
    result = get_last_calculation()
    print(f"  Result: {result}")
    # Should return a dictionary with calculation details
    assert isinstance(result, dict), f"Expected dict, got {type(result)}"
    
    print("  ✅ Utility functions tests passed!")

def test_error_handling():
    """Test error handling"""
    print("\nTesting Error Handling...")
    
    from main import divide, square_root, factorial
    
    # Test division by zero
    print("  Testing division by zero")
    try:
        divide(10, 0)
        assert False, "Expected ValueError for division by zero"
    except ValueError as e:
        print(f"  Caught expected error: {e}")
    
    # Test square root of negative number
    print("  Testing square root of negative number")
    try:
        square_root(-1)
        assert False, "Expected ValueError for negative square root"
    except ValueError as e:
        print(f"  Caught expected error: {e}")
    
    # Test factorial of negative number
    print("  Testing factorial of negative number")
    try:
        factorial(-1)
        assert False, "Expected ValueError for negative factorial"
    except ValueError as e:
        print(f"  Caught expected error: {e}")
    
    print("  ✅ Error handling tests passed!")

def test_http_server():
    """Test HTTP server functionality"""
    print("\nTesting HTTP Server...")
    
    # Start the server in a subprocess
    server_process = None
    try:
        print("  Starting MCP server...")
        server_process = subprocess.Popen(
            [sys.executable, "main.py"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        # Wait a bit for server to start
        time.sleep(3)
        
        # Test if server is running
        try:
            response = requests.get("http://localhost:8000/", timeout=5)
            print(f"  Server responded with status: {response.status_code}")
            print("  ✅ HTTP server test passed!")
        except requests.exceptions.RequestException as e:
            print(f"  ❌ HTTP server test failed: {e}")
            return False
        
    except Exception as e:
        print(f"  ❌ Failed to start server: {e}")
        return False
    
    finally:
        # Clean up server process
        if server_process:
            server_process.terminate()
            server_process.wait()
    
    return True

def run_all_tests():
    """Run all tests"""
    print("🧮 Enhanced Calculator MCP Server - Test Suite")
    print("=" * 50)
    
    try:
        test_basic_arithmetic()
        test_advanced_operations()
        test_trigonometric_functions()
        test_memory_operations()
        test_statistical_operations()
        test_utility_functions()
        test_error_handling()
        test_http_server()
        
        print("\n" + "=" * 50)
        print("🎉 All tests passed! The calculator server is working correctly.")
        print("=" * 50)
        
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run_all_tests() 