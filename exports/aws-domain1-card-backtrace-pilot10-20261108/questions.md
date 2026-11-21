# 首批10题完整原文

只含题干及全部选项，不含印刷答案、旧题解或旧PASS。

## Q3

A company uses AWS Organizations to manage multiple AWS accounts for different departments. The management account has an Amazon
S3 bucket that contains project reports. The company wants to limit access to this S3 bucket to only users of accounts within the organization
in AWS Organizations.
Which solution meets these requirements with the LEAST amount of operational overhead?

A. Add the aws PrincipalOrgID global condition key with a reference to the organization ID to the S3 bucket policy.

B. Create an organizational unit (OU) for each department. Add the aws:PrincipalOrgPaths global condition key to the S3 bucket policy.

C. Use AWS CloudTrail to monitor the CreateAccount, InviteAccountToOrganization, LeaveOrganization, and
RemoveAccountFromOrganization events. Update the S3 bucket policy accordingly.

D. Tag each user that needs access to the S3 bucket. Add the aws:PrincipalTag global condition key to the S3 bucket policy.

## Q200

A company hosts its application on AWS. The company uses Amazon Cognito to manage users. When users log in to the application, the
application fetches required data from Amazon DynamoDB by using a REST API that is hosted in Amazon API Gateway. The company wants an
AWS managed solution that will control access to the REST API to reduce development efforts.
Which solution will meet these requirements with the LEAST operational overhead?

A. Configure an AWS Lambda function to be an authorizer in API Gateway to validate which user made the request.

B. For each user, create and assign an API key that must be sent with each request. Validate the key by using an AWS Lambda function.

C. Send the user’s email address in the header with every request. Invoke an AWS Lambda function to validate that the user with that
email address has proper access.

D. Configure an Amazon Cognito user pool authorizer in API Gateway to allow Amazon Cognito to validate each request.

## Q761

A company needs to use its on-premises LDAP directory service to authenticate its users to the AWS Management Console. The directory
service is not compatible with Security Assertion Markup Language (SAML).
Which solution meets these requirements?

A. Enable AWS IAM Identity Center (AWS Single Sign-On) between AWS and the on-premises LDAP.

B. Create an IAM policy that uses AWS credentials, and integrate the policy into LDAP.

C. Set up a process that rotates the IAM credentials whenever LDAP credentials are updated.

D. Develop an on-premises custom identity broker application or process that uses AWS Security Token Service (AWS STS) to get short-
lived credentials.

## Q74

A solutions architect is designing a two-tier web application. The application consists of a public-facing web tier hosted on Amazon EC2 in
public subnets. The database tier consists of Microsoft SQL Server running on Amazon EC2 in a private subnet. Security is a high priority for
the company.
How should security groups be configured in this situation? (Choose two.)

A. Configure the security group for the web tier to allow inbound traffic on port 443 from 0.0.0.0/0.

B. Configure the security group for the web tier to allow outbound traffic on port 443 from 0.0.0.0/0.

C. Configure the security group for the database tier to allow inbound traffic on port 1433 from the security group for the web tier.

D. Configure the security group for the database tier to allow outbound traffic on ports 443 and 1433 to the security group for the web tier.

E. Configure the security group for the database tier to allow inbound traffic on ports 443 and 1433 from the security group for the web
tier.

## Q165

A solutions architect must design a solution that uses Amazon CloudFront with an Amazon S3 origin to store a static website. The company’s
security policy requires that all website traffic be inspected by AWS WAF.
How should the solutions architect comply with these requirements?

A. Configure an S3 bucket policy to accept requests coming from the AWS WAF Amazon Resource Name (ARN) only.

B. Configure Amazon CloudFront to forward all incoming requests to AWS WAF before requesting content from the S3 origin.

C. Configure a security group that allows Amazon CloudFront IP addresses to access Amazon S3 only. Associate AWS WAF to CloudFront.

D. Configure Amazon CloudFront and Amazon S3 to use an origin access identity (OAI) to restrict access to the S3 bucket. Enable AWS
WAF on the distribution.

## Q657

A company has multiple AWS accounts in an organization in AWS Organizations that different business units use. The company has multiple
offices around the world. The company needs to update security group rules to allow new office CIDR ranges or to remove old CIDR ranges
across the organization. The company wants to centralize the management of security group rules to minimize the administrative overhead
that updating CIDR ranges requires.
Which solution will meet these requirements MOST cost-effectively?

A. Create VPC security groups in the organization's management account. Update the security groups when a CIDR range update is
necessary.

B. Create a VPC customer managed prefix list that contains the list of CIDRs. Use AWS Resource Access Manager (AWS RAM) to share the
prefix list across the organization. Use the prefix list in the security groups across the organization.

C. Create an AWS managed prefix list. Use an AWS Security Hub policy to enforce the security group update across the organization. Use
an AWS Lambda function to update the prefix list automatically when the CIDR ranges change.

D. Create security groups in a central administrative AWS account. Create an AWS Firewall Manager common security group policy for the
whole organization. Select the previously created security groups as primary groups in the policy.

## Q36

A company is building an application in the AWS Cloud. The application will store data in Amazon S3 buckets in two AWS Regions. The
company must use an AWS Key Management Service (AWS KMS) customer managed key to encrypt all data that is stored in the S3 buckets.
The data in both S3 buckets must be encrypted and decrypted with the same KMS key. The data and the key must be stored in each of the two
Regions.
Which solution will meet these requirements with the LEAST operational overhead?

A. Create an S3 bucket in each Region. Configure the S3 buckets to use server-side encryption with Amazon S3 managed encryption keys
(SSE-S3). Configure replication between the S3 buckets.

B. Create a customer managed multi-Region KMS key. Create an S3 bucket in each Region. Configure replication between the S3 buckets.
Configure the application to use the KMS key with client-side encryption.

C. Create a customer managed KMS key and an S3 bucket in each Region. Configure the S3 buckets to use server-side encryption with
Amazon S3 managed encryption keys (SSE-S3). Configure replication between the S3 buckets.

D. Create a customer managed KMS key and an S3 bucket in each Region. Configure the S3 buckets to use server-side encryption with AWS
KMS keys (SSE-KMS). Configure replication between the S3 buckets.

## Q92

A company is storing sensitive user information in an Amazon S3 bucket. The company wants to provide secure access to this bucket from the
application tier running on Amazon EC2 instances inside a VPC.
Which combination of steps should a solutions architect take to accomplish this? (Choose two.)

A. Configure a VPC gateway endpoint for Amazon S3 within the VPC.

B. Create a bucket policy to make the objects in the S3 bucket public.

C. Create a bucket policy that limits access to only the application tier running in the VPC.

D. Create an IAM user with an S3 access policy and copy the IAM credentials to the EC2 instance.

E. Create a NAT instance and have the EC2 instances use the NAT instance to access the S3 bucket.

## Q106

A company is preparing to store confidential data in Amazon S3. For compliance reasons, the data must be encrypted at rest. Encryption key
usage must be logged for auditing purposes. Keys must be rotated every year.
Which solution meets these requirements and is the MOST operationally efficient?

A. Server-side encryption with customer-provided keys (SSE-C)

B. Server-side encryption with Amazon S3 managed keys (SSE-S3)

C. Server-side encryption with AWS KMS keys (SSE-KMS) with manual rotation

D. Server-side encryption with AWS KMS keys (SSE-KMS) with automatic rotation

## Q189

A company needs to store contract documents. A contract lasts for 5 years. During the 5-year period, the company must ensure that the
documents cannot be overwritten or deleted. The company needs to encrypt the documents at rest and rotate the encryption keys
automatically every year.
Which combination of steps should a solutions architect take to meet these requirements with the LEAST operational overhead? (Choose
two.)

A. Store the documents in Amazon S3. Use S3 Object Lock in governance mode.

B. Store the documents in Amazon S3. Use S3 Object Lock in compliance mode.

C. Use server-side encryption with Amazon S3 managed encryption keys (SSE-S3). Configure key rotation.

D. Use server-side encryption with AWS Key Management Service (AWS KMS) customer managed keys. Configure key rotation.

E. Use server-side encryption with AWS Key Management Service (AWS KMS) customer provided (imported) keys. Configure key rotation.
