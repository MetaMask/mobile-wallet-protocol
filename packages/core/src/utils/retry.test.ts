import * as t from "vitest";
import { retry } from "./retry";

t.describe("retry", () => {
	t.it("should return the result on the first attempt if it succeeds", async () => {
		const successfulFn = t.vi.fn().mockResolvedValue("success");
		const options = { attempts: 3, delay: 100 };

		const result = await retry(successfulFn, options);

		t.expect(result).toBe("success");
		t.expect(successfulFn).toHaveBeenCalledTimes(1);
	});

	t.it("should retry the function and succeed on the second attempt", async () => {
		const failingThenSuccessfulFn = t.vi.fn().mockRejectedValueOnce(new Error("First failure")).mockResolvedValueOnce("success");

		const options = { attempts: 3, delay: 10 }; // Use shorter delay for faster tests

		const result = await retry(failingThenSuccessfulFn, options);

		t.expect(result).toBe("success");
		t.expect(failingThenSuccessfulFn).toHaveBeenCalledTimes(2);
	});

	t.it("should throw the last error after exhausting all attempts", async () => {
		const lastError = new Error("Final failure");
		const alwaysFailingFn = t.vi.fn().mockRejectedValueOnce(new Error("Fail 1")).mockRejectedValueOnce(new Error("Fail 2")).mockRejectedValue(lastError);

		const options = { attempts: 3, delay: 10 }; // Use shorter delay for faster tests

		await t.expect(retry(alwaysFailingFn, options)).rejects.toThrow(lastError);
		t.expect(alwaysFailingFn).toHaveBeenCalledTimes(3);
	});

	t.it("should not retry if attempts is 1 and it fails", async () => {
		const error = new Error("Failure");
		const failingFn = t.vi.fn().mockRejectedValue(error);
		const options = { attempts: 1, delay: 100 };

		await t.expect(retry(failingFn, options)).rejects.toThrow(error);

		t.expect(failingFn).toHaveBeenCalledTimes(1);
	});

	t.it("should handle zero delay without errors", async () => {
		const failingThenSuccessfulFn = t.vi.fn().mockRejectedValueOnce(new Error("Failure")).mockResolvedValueOnce("success");

		const options = { attempts: 2, delay: 0 };
		const result = await retry(failingThenSuccessfulFn, options);

		t.expect(result).toBe("success");
		t.expect(failingThenSuccessfulFn).toHaveBeenCalledTimes(2);
	});

	t.it("should throw an unexpected error if attempts is 0", async () => {
		const fn = t.vi.fn();
		const options = { attempts: 0, delay: 100 };

		// The loop will not run, and it will hit the "unreachable" code
		await t.expect(retry(fn, options)).rejects.toThrow("Retry logic failed unexpectedly.");
		t.expect(fn).not.toHaveBeenCalled();
	});

	t.it("should use exponential backoff for delays", async () => {
		const alwaysFailingFn = t.vi.fn().mockRejectedValueOnce(new Error("Fail 1")).mockRejectedValueOnce(new Error("Fail 2")).mockRejectedValue(new Error("Final failure"));

		const options = { attempts: 3, delay: 10 };
		const startTime = Date.now();

		await t.expect(retry(alwaysFailingFn, options)).rejects.toThrow("Final failure");

		const totalTime = Date.now() - startTime;
		// Should wait at least 10ms (first retry) + 20ms (second retry) = 30ms
		// Adding some tolerance for test execution time
		t.expect(totalTime).toBeGreaterThanOrEqual(25);
		t.expect(alwaysFailingFn).toHaveBeenCalledTimes(3);
	});
});
